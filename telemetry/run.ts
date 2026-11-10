import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startCollectors } from "./collector.ts";

// CLAUDE CODE TELEMETRY LAB
//
//   npm run telemetry -- <scenario>
//   scenarios: basic | off | noprotocol | split | privacy | tags | repo
//
// The Agent SDK runs Claude Code under the hood, so Claude Code's OpenTelemetry
// switches work here exactly as they do in the CLI. Every scenario:
//   1) starts two fake collectors (A on :4318, B on :4319, see collector.ts)
//   2) runs the SAME tiny task: Bash `echo hello`, then a one-word reply
//   3) changes ONLY the telemetry env vars
//   4) prints what each collector received


const SANDBOX = join(import.meta.dirname, "..", "sandbox", "telemetry");

// The base every working scenario starts from. Read each line and say what it does out loud.
const BASE: Record<string, string> = {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",           // master switch. Without it: nothing, anywhere.
  OTEL_METRICS_EXPORTER: "otlp",               // metrics pipe -> OTLP
  OTEL_LOGS_EXPORTER: "otlp",                  // events pipe  -> OTLP (events only flow if this is set)
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",    // NO default. Our fake collector only reads JSON.
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318", // generic endpoint for every signal -> A
  OTEL_METRIC_EXPORT_INTERVAL: "2000",         // default 60000 ms; shortened so the demo isn't slow
  OTEL_LOGS_EXPORT_INTERVAL: "1000",           // default 5000 ms
};

type Scenario = { title: string; env: Record<string, string>; repoSettings?: object; predict: string };

const without = (key: string) => Object.fromEntries(Object.entries(BASE).filter(([k]) => k !== key));

const scenarios: Record<string, Scenario> = {
  basic: {
    title: "Basic: everything on, one generic endpoint",
    env: BASE,
    predict: "Where do metrics and events land? What does the user_prompt event show for the prompt text?",
  },
  off: {
    title: "Off: every OTEL var set, but CLAUDE_CODE_ENABLE_TELEMETRY removed",
    env: without("CLAUDE_CODE_ENABLE_TELEMETRY"),
    predict: "Does anything arrive anywhere?",
  },
  noprotocol: {
    title: "No protocol: exporters + endpoint set, OTEL_EXPORTER_OTLP_PROTOCOL removed",
    env: without("OTEL_EXPORTER_OTLP_PROTOCOL"),
    predict: "The docs say Claude Code has no default protocol. What do you expect A to receive?",
  },
  split: {
    title: "Split: metrics -> A, logs/events -> B (mock 2, Q60)",
    env: {
      ...BASE,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://127.0.0.1:4318/v1/metrics",
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://127.0.0.1:4319/v1/logs",
    },
    predict: "Which collector gets METRIC lines, which gets EVENT lines? Why don't you need a load balancer?",
  },
  privacy: {
    title: "Privacy: OTEL_LOG_TOOL_DETAILS=1, prompts left at default (quiz Q1)",
    env: { ...BASE, OTEL_LOG_TOOL_DETAILS: "1" },
    predict: "Does the Bash command `echo hello` appear? Does the prompt text appear? " +
      "Then try adding OTEL_LOG_USER_PROMPTS=1 yourself and run again.",
  },
  tags: {
    title: "Tags: OTEL_RESOURCE_ATTRIBUTES for team / user / cost centre (quiz Q2, mock 3)",
    env: { ...BASE, OTEL_RESOURCE_ATTRIBUTES: "team.id=platform,enduser.id=bharath,cost_center=eng-123" },
    predict: "Where do team.id / enduser.id show up? Bonus: put a space in a value and see what breaks.",
  },
  repo: {
    title: "Repo: launch env points at A, the project's .claude/settings.json points at B (quiz Q3)",
    env: BASE,
    repoSettings: { env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4319" } },
    predict: "The 'stranger' repo says send everything to B. Where does the data actually go?",
  },
};

function resetSandbox(repoSettings?: object) {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(SANDBOX, { recursive: true });
  if (repoSettings) {
    mkdirSync(join(SANDBOX, ".claude"), { recursive: true });
    writeFileSync(join(SANDBOX, ".claude", "settings.json"), JSON.stringify(repoSettings, null, 2));
  }
}

// Remove any OTEL/telemetry vars you might have in your own shell, so ONLY the scenario counts.
function cleanParentEnv() {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("OTEL_") || k === "CLAUDE_CODE_ENABLE_TELEMETRY") delete env[k];
  }
  return env;
}

async function run(name: string) {
  const s = scenarios[name];
  if (!s) {
    console.log(`Unknown scenario "${name}". Pick one of: ${Object.keys(scenarios).join(", ")}`);
    return;
  }
  resetSandbox(s.repoSettings);
  const collectors = await startCollectors();

  console.log(`\n=== ${s.title} ===`);
  console.log(`PREDICT FIRST: ${s.predict}\n`);
  console.log("telemetry env for this run:");
  for (const [k, v] of Object.entries(s.env)) console.log(`  ${k}=${v}`);
  if (s.repoSettings) console.log(`repo .claude/settings.json: ${JSON.stringify(s.repoSettings)}`);
  console.log("\n--- collector output ---");

  for await (const msg of query({
    prompt: "Run the bash command: echo hello. Then reply with exactly one word: done",
    options: {
      model: "claude-haiku-5-5",
      cwd: SANDBOX,
      maxTurns: 4,
      // Load the project's settings ONLY in the repo scenario, so the stranger's file is actually read.
      settingSources: s.repoSettings ? ["project"] : [],
      // Pre-approve exactly one command. Default mode, no bypass needed.
      permissionMode: "default",
      allowedTools: ["Bash(echo *)"],
      env: { ...cleanParentEnv(), ...s.env },
    },
  })) {
    if (msg.type === "result") {
      console.log(`\n(Claude replied: ${"result" in msg ? msg.result : "(no text)"}, cost $${msg.total_cost_usd?.toFixed(4)})`);
    }
  }

  // Claude Code flushes on exit, but give the last HTTP posts a moment to land.
  await new Promise((r) => setTimeout(r, 3000));
  await collectors.stop();

  const { A, B } = collectors.counts;
  console.log("\n--- summary ---");
  console.log(`A :4318  metrics batches=${A.metrics}  log batches=${A.logs}  undecoded=${A.other}`);
  console.log(`B :4319  metrics batches=${B.metrics}  log batches=${B.logs}  undecoded=${B.other}`);
}

run(process.argv[2] ?? "basic");
