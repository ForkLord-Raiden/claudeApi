import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

// CONTEXT EDITING DEMO
// An agent reads several big log files. Each read dumps ~3k tokens of tool_result
// into the conversation. Once input passes the trigger, the API clears the OLDEST
// tool results server-side (replaces them with a placeholder) before the model sees them.
// Your local `messages` array is NOT changed. Watch input_tokens and applied_edits per turn.

const MAX_ITERATIONS = 12;

// Fake, deterministic log generator: no external calls, same output every run.
function fakeLog(file: string): string {
  const lines: string[] = [];
  for (let i = 1; i <= 120; i++) {
    lines.push(`2026-11-02T10:${String(i % 60).padStart(2, "0")}:00Z INFO  [${file}] request ${i} ok latency=${(i * 7) % 300}ms user=u${i % 17}`);
    if (file === "app-2.log" && i === 77) {
      lines.push(`2026-11-02T10:17:00Z ERROR [${file}] payment-service timeout after 30000ms orderId=ORD-4471`);
    }
  }
  return lines.join("\n");
}

const tools: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "readConfig",
    description: "Returns the list of log files to inspect. Call this first.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "readLog",
    description: "Returns the full contents of one log file.",
    input_schema: {
      type: "object",
      properties: { file: { type: "string", description: "e.g. app-1.log" } },
      required: ["file"],
    },
  },
];

const handlers: Record<string, (input: any) => string> = {
  readConfig: () => "Log files: app-1.log, app-2.log, app-3.log, app-4.log, app-5.log",
  readLog: ({ file }) => fakeLog(file),
};

async function run() {
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    {
      role: "user",
      content:
        "Read the config, then read each log file ONE AT A TIME (one tool call per turn). " +
        "Find any ERROR line. Final answer: which file, the exact error, and the orderId.",
    },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await client.beta.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 1000,
      tools,
      messages,
      betas: ["context-management-2025-06-27"],
      context_management: {
        edits: [
          {
            type: "clear_tool_uses_20250919",
            trigger: { type: "input_tokens", value: 8000 }, // low on purpose so you SEE it fire
            keep: { type: "tool_uses", value: 2 },          // keep the 2 most recent tool results
            exclude_tools: ["readConfig"],                  // never clear the config result
            // clear_at_least: { type: "input_tokens", value: 3000 }, // try this: skip tiny clears that only break the cache
            // clear_tool_inputs: true,                               // also wipe the tool call params
          },
        ],
      },
    });

    const edits = (res as any).context_management?.applied_edits ?? [];
    console.log(
      `turn ${i + 1}: input_tokens=${res.usage.input_tokens} stop=${res.stop_reason}`,
      edits.length ? `CLEARED -> ${JSON.stringify(edits)}` : "(no clearing)",
    );

    if (res.stop_reason !== "tool_use") {
      const text = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
      console.log("\nFINAL ANSWER:\n" + text);
      return;
    }

    messages.push({ role: "assistant", content: res.content });

    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      console.log(`   -> ${block.name}(${JSON.stringify(block.input)})`);
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: handlers[block.name](block.input),
      });
    }
    messages.push({ role: "user", content: results });
  }
  console.log("Hit MAX_ITERATIONS");
}

run();
