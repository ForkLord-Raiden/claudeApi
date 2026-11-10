import { createServer, type Server } from "node:http";
import { gunzipSync } from "node:zlib";

// A TINY FAKE OTEL COLLECTOR
//
// In real life this would be Grafana / Datadog / Honeycomb / an OpenTelemetry Collector.
// Here it's ~100 lines that accept OTLP over HTTP with JSON encoding
// (OTEL_EXPORTER_OTLP_PROTOCOL=http/json) and print what Claude Code sent.
//
// It listens on TWO ports so you can SEE where each signal lands:
//   4318 = "BACKEND A" (the company collector)
//   4319 = "BACKEND B" (a second backend, or a stranger, depending on the scenario)
//
// Standard OTLP/HTTP paths:  /v1/metrics   /v1/logs   /v1/traces

type KV = { key: string; value: Record<string, unknown> };

const SHOW_RESOURCE_KEYS = [
  "service.name",
  "service.version",
  "os.type",
  // anything you add with OTEL_RESOURCE_ATTRIBUTES shows up here too, so print every non-standard key:
];

function val(v: Record<string, unknown> | undefined): unknown {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return Number(v.intValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("boolValue" in v) return v.boolValue;
  return JSON.stringify(v);
}

function attrs(list: KV[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of list ?? []) out[a.key] = val(a.value);
  return out;
}

const STANDARD_RESOURCE = new Set([
  "service.name", "service.version", "os.type", "os.version", "host.arch", "wsl.version",
  "telemetry.sdk.name", "telemetry.sdk.language", "telemetry.sdk.version", "process.pid",
  "host.name",
]);

function printResource(label: string, resourceAttrs: Record<string, unknown>) {
  const shown = SHOW_RESOURCE_KEYS.filter((k) => k in resourceAttrs).map((k) => `${k}=${resourceAttrs[k]}`);
  const custom = Object.keys(resourceAttrs).filter((k) => !STANDARD_RESOURCE.has(k));
  console.log(`[${label}] resource: ${shown.join("  ")}`);
  if (custom.length) {
    console.log(`[${label}]   custom resource attrs (from OTEL_RESOURCE_ATTRIBUTES): ` +
      custom.map((k) => `${k}=${resourceAttrs[k]}`).join("  "));
  }
}

// Attributes that are on almost every record. Hidden so the interesting ones stand out.
const NOISE = new Set([
  "session.id", "user.id", "user.account_uuid", "user.account_id", "organization.id", "user.email",
  "terminal.type", "app.version", "app.entrypoint", "event.timestamp", "event.sequence",
  "prompt.id", "message.uuid", "client_request_id", "request_id", "tool_use_id", "workspace.host_paths",
]);

function short(a: Record<string, unknown>) {
  return Object.entries(a)
    .filter(([k]) => !NOISE.has(k))
    .map(([k, v]) => {
      const s = String(v);
      return `${k}=${s.length > 80 ? s.slice(0, 77) + "..." : s}`;
    })
    .join("  ");
}

function handleMetrics(label: string, body: any) {
  for (const rm of body.resourceMetrics ?? []) {
    printResource(label, attrs(rm.resource?.attributes));
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of sm.metrics ?? []) {
        const points = m.sum?.dataPoints ?? m.gauge?.dataPoints ?? m.histogram?.dataPoints ?? [];
        for (const p of points) {
          const value = p.asDouble ?? (p.asInt !== undefined ? Number(p.asInt) : p.sum);
          console.log(`[${label}] METRIC ${m.name} = ${value}${m.unit ? " " + m.unit : ""}   ${short(attrs(p.attributes))}`);
        }
      }
    }
  }
}

function handleLogs(label: string, body: any) {
  for (const rl of body.resourceLogs ?? []) {
    printResource(label, attrs(rl.resource?.attributes));
    for (const sl of rl.scopeLogs ?? []) {
      for (const r of sl.logRecords ?? []) {
        const a = attrs(r.attributes);
        const name = a["event.name"] ?? val(r.body) ?? "(unnamed)";
        console.log(`[${label}] EVENT  ${name}   ${short(a)}`);
      }
    }
  }
}

export type Counts = { metrics: number; logs: number; traces: number; other: number };

function startOne(port: number, label: string, counts: Counts): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let raw = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
      const type = String(req.headers["content-type"] ?? "");
      const path = req.url ?? "";

      if (!type.includes("json")) {
        // http/protobuf or anything else: we can't decode it, but we can prove it arrived
        console.log(`[${label}] got ${raw.length} bytes on ${path} as "${type}" (not JSON, not decoded)`);
        counts.other++;
      } else {
        const body = JSON.parse(raw.toString("utf8") || "{}");
        if (path.endsWith("/v1/metrics")) { counts.metrics++; handleMetrics(label, body); }
        else if (path.endsWith("/v1/logs")) { counts.logs++; handleLogs(label, body); }
        else if (path.endsWith("/v1/traces")) { counts.traces++; console.log(`[${label}] TRACES batch received`); }
        else { counts.other++; console.log(`[${label}] unknown path ${path}`); }
      }
      if (req.headers.authorization) console.log(`[${label}]   (auth header present: ${req.headers.authorization.slice(0, 12)}...)`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

export async function startCollectors() {
  const a: Counts = { metrics: 0, logs: 0, traces: 0, other: 0 };
  const b: Counts = { metrics: 0, logs: 0, traces: 0, other: 0 };
  const servers = [await startOne(4318, "A:4318", a), await startOne(4319, "B:4319", b)];
  return {
    counts: { A: a, B: b },
    stop: () => Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null))))),
  };
}

// Run standalone too: `npm run collector`, then point anything OTLP/http-json at it.
if (process.argv[1]?.endsWith("collector.ts")) {
  await startCollectors();
  console.log("Fake collectors listening: A on http://127.0.0.1:4318, B on http://127.0.0.1:4319 (Ctrl+C to stop)");
}
