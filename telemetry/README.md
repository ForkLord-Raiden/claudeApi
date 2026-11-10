# Telemetry lab

Claude Code's OpenTelemetry output, made visible. The Agent SDK runs Claude Code underneath, so the same env vars apply.

```
npm run telemetry -- basic        # start here
npm run telemetry -- <scenario>   # basic | off | noprotocol | split | privacy | tags | repo
npm run collector                 # optional: just the fake collectors, for poking with your own runs
```

You need `ANTHROPIC_API_KEY` set (see the top-level README). Each run is one small Haiku call.

## The picture

```
            CLAUDE_CODE_ENABLE_TELEMETRY=1      <- master switch
                         |
        +----------------+-----------------+
     METRICS          EVENTS (logs)      TRACES (beta)
    "how much"       "what happened"    "how it connects"
        |                |                  |
 OTEL_METRICS_     OTEL_LOGS_          OTEL_TRACES_
 EXPORTER          EXPORTER            EXPORTER
        |                |                  |
        +-- OTEL_EXPORTER_OTLP_ENDPOINT (generic) --+
            overridden per signal by _METRICS_ / _LOGS_ / _TRACES_ENDPOINT
```

`collector.ts` pretends to be two backends: **A on :4318** and **B on :4319**. It only decodes `http/json`.

## The rule for every scenario

Before you run it, write down what A and B will receive. Then run it. If you were wrong, say why before you scroll down.

| Scenario     | What changes                                               | Quiz link       |
| ------------ | ---------------------------------------------------------- | --------------- |
| `basic`      | Everything on, one generic endpoint                        |                 |
| `off`        | Master switch removed                                      |                 |
| `noprotocol` | Protocol removed                                           |                 |
| `split`      | Per-signal endpoints: metrics to A, logs to B              | Mock 2, Q60     |
| `privacy`    | `OTEL_LOG_TOOL_DETAILS=1`, prompts left at default         | Quiz Q1         |
| `tags`       | `OTEL_RESOURCE_ATTRIBUTES` with team, user and cost centre | Quiz Q2, mock 3 |
| `repo`       | Repo settings try to send everything to B                  | Quiz Q3         |

## Things to try on your own

1. In `privacy`, add `OTEL_LOG_USER_PROMPTS: "1"` and compare the `user_prompt` event.
2. In `tags`, put a space inside a value (`team.id=my team`). Watch what happens to the attributes.
3. In `basic`, change the protocol to `http/protobuf`. The collector says "not decoded", but the data still arrives. The protocol is just the encoding.
4. Find `claude_code.token.usage` and its `type` attribute. Which of the four values (`input`, `output`, `cacheRead`, `cacheCreation`) show up on a single short call, and why?

---

## Answers (scroll only after predicting)

These come from the docs. If your run shows something different, trust the run and tell Rem. That's worth knowing.

- **basic:** METRIC and EVENT lines both land on A. `user_prompt` shows `prompt_length`, but the prompt text is redacted.
- **off:** Nothing anywhere. The OTEL variables are just config for a pipe that was never switched on.
- **noprotocol:** You should get nothing, or an exporter error, because there is no default protocol. Whatever actually happens, note it down: it's the real answer.
- **split:** METRIC lines on A, EVENT lines on B. A per-signal endpoint overrides the generic one for that signal only, so you don't need any extra infrastructure.
- **privacy:** The `tool_result` and `tool_decision` events now carry the Bash command (`tool_parameters`, `tool_input`). The prompt text is still redacted, because that is a separate switch.
- **tags:** `team.id`, `enduser.id` and `cost_center` appear as custom resource attributes on every batch, metrics and events alike. That is how you split one shared API key by team or user.
- **repo:** Everything still lands on **A**. A repo's `.claude/settings.json` cannot set OTEL exporter variables, so a stranger's repo can't redirect your telemetry. Enforcement lives in **managed settings** (`env` block).
