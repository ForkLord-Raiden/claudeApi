# Claude API Cheat Sheet

Notes from a hands-on sprint with the Claude Messages API in TypeScript (`@anthropic-ai/sdk`, model `claude-haiku-5-5`). Written for the Claude Certified Architect – Professional prep. Model IDs, parameters and prices change, so check the official docs before relying on any detail here.

## 1. The response object

| Field | What it tells you |
|---|---|
| `content` | Array of typed blocks (`text`, `thinking`, `tool_use`). **Not a string.** Loop over the blocks and check each `type`. |
| `stop_reason` | Why generation stopped. Drives your control flow. |
| `usage` | Tokens used and billed: `input_tokens`, `output_tokens`, cache fields, `thinking_tokens`. |
| `role` | Always `assistant`. |
| `model`, `id` | Which model answered, and the message ID (useful for tracing). |

- The API is **stateless**. For a follow-up you resend the whole history yourself.
- A **token** is a chunk of text (roughly 3-4 characters), not a character. Output tokens cost more than input tokens.
- `max_tokens` caps **thinking plus answer combined**. Set too low, you can get a `thinking` block and no text at all.
- Thinking tokens are billed even when the thinking text is not returned.
- `temperature`, `top_p` and `top_k` are rejected with a 400 (docs: since 2026-10-21, every model). Don't copy them from old tutorials.

## 2. `stop_reason` values and what to do

| Value | Meaning | Your code should |
|---|---|---|
| `end_turn` | Finished normally | Use the answer |
| `tool_use` | Claude wants a tool run | Run it, send a `tool_result`, call again |
| `max_tokens` | Cut off | Raise the limit, or handle a partial or empty answer |
| `stop_sequence` | Hit a custom stop string | Treat as an intended stop |
| `refusal` | Safety decline | Check it before reading `content` |
| `pause_turn` | A server-tool turn paused | Continue the turn |

Errors: a `400` means your request is wrong, so don't retry it. `429` and `5xx` are worth retrying with backoff.

## 3. System prompt

- Not "executed first". Claude reads `system` and `messages` together as one input.
- Holds the standing rules: role, behaviour, format, limits. Set by the developer, and treated as higher priority than user text.
- Separate from `messages` for: authority, persistence, **caching**, and the trust boundary (user input and tool results are untrusted).
- **It is not a security boundary.** Resisting "ignore previous instructions" is a learned tendency, not a guarantee.
- Defense in depth: rules in `system`, least-privilege tools, **validate in code**, human approval for risky actions.
- Indirect injection (instructions hidden in a web page, email or tool result) is the bigger agent risk.

## 4. Tool use

**A tool definition has three parts:**
1. `name`: the identifier.
2. `description`: tells Claude **when** to use it. The most important part.
3. `input_schema`: JSON Schema for the arguments (`required` lives inside it).

**Who runs what:**
- **Client tools** run in your code: your own tools, plus Anthropic-schema ones (`bash`, `text_editor`, `memory`, computer use, browser use).
- **Server tools** run on Anthropic's side: `web_search`, `web_fetch`, `code_execution`, `tool_search`, `advisor`, the MCP connector.
- There is **no built-in calculator**. Write a deterministic tool, or use `code_execution`.
- The tool's code is deterministic. Claude's *decision* to call it, and its arguments, are probabilistic.

**The round trip:**

```
CALL 1   send: question + tool definitions
         get:  stop_reason "tool_use" + a tool_use block { id, name, input }

         YOU run the handler (your code, no API call)

CALL 2   send: history + Claude's reply (role: assistant)
                      + tool_result       (role: user, tool_use_id = the id above)
         get:  final text, stop_reason "end_turn"
```

- `tool_result` goes in a **user** message. `assistant` is Claude's turn, tool requests included.
- `tool_use_id` must match the `id` of the `tool_use` block.
- Every `tool_use` needs a matching `tool_result`. Missing, wrong or absent IDs all return a `400`.
- Pass `res.content` back **unchanged** (thinking blocks included). Don't keep only the text blocks.
- Tool definitions cost input tokens on every call.
- Two same-role messages in a row get merged by the API. That caused a confusing `messages.0.content.1` error when the assistant message was missing.

## 5. The agent loop

```ts
for (let i = 0; i < MAX_ITERATIONS; i++) {
  const res = await client.messages.create({ model, max_tokens, tools, messages });
  messages.push({ role: "assistant", content: res.content });

  if (res.stop_reason !== "tool_use") return res;      // done

  const results = [];
  for (const block of res.content) {
    if (block.type !== "tool_use") continue;
    try {
      results.push({ type: "tool_result", tool_use_id: block.id, content: await handlers[block.name](block.input) });
    } catch (e) {
      results.push({ type: "tool_result", tool_use_id: block.id, content: String(e), is_error: true });
    }
  }
  messages.push({ role: "user", content: results });   // ONE message, all results
}
throw new Error("Hit max iterations");
```

- The loop checks `stop_reason`, not the text: a reply can hold text **and** a tool request.
- A tool error becomes `is_error: true` and the loop continues. An uncaught API error crashes it.
- `!== "tool_use"` also exits on `max_tokens` and `refusal`. Check `end_turn` before trusting the result.
- **Looping on one tool, three causes:** the tool returns empty or unhelpful results (fix the tool, return actionable errors); vague or overlapping descriptions (say when to use it and when not to); broken history so Claude never sees its results (append the full reply and every `tool_result`).

## 6. Prompt caching

- Reuses the work done on an **unchanged prefix**. Saves **cost** (cache reads bill far cheaper) and **latency**. It is not retrieval.
- Mark it with `cache_control: { type: "ephemeral" }`, optionally `ttl: "1h"`. The default is 5 minutes, and only `5m` and `1h` exist. Each hit refreshes the timer.
- The prefix (`tools`, then `system`, then `messages`, up to the breakpoint) must be **identical byte for byte**. What comes after can change every request.
- Put stable content first and volatile content (timestamps, user questions) after. A timestamp in the system prompt silently kills hits.
- Below the model's minimum size, nothing caches and you get no error.
- Verify with `usage.cache_read_input_tokens`. It should be above 0 on the repeat call.
- Cost spike after adding a long knowledge base: cache the stable prefix first. If it is too large for context, retrieve (RAG).

## 7. Structured output

- Define a tool whose `input_schema` is the shape you want, and read the `tool_use` block's `input`. No `tool_result` step is needed.
- `strict: true` (with `additionalProperties: false` and a full `required` list) makes the API enforce the schema.
- Forcing with `tool_choice` adds about 120 tokens of overhead, and returns a `400` on some models. The portable pattern is `auto` + a clear description + `strict`.

## 8. Streaming

- Changes **delivery**, not content. It does not replace the agent loop (streaming sits inside the loop).
- `client.messages.stream(...)` with `.on("text", ...)` for live text, and `await stream.finalMessage()` for the full message.
- Stream when a human is watching or the output is long. Plain `create` is fine when code consumes the result.

## 9. Design trade-offs (the exam-style ones)

- **Haiku vs Opus for a subagent:** Haiku for narrow, well-defined, high-volume work (cost and latency multiply across subagents). Opus when judgment is needed or an error is costly. Judge cost per **completed task**, and measure with an eval.
- **Refund bot must never invent amounts:** the model can only get an amount from a tool; the prompt says so; code checks the reply against tool results; cap and human approval for large amounts.
- **One agent vs subagents:** start with one. Split for context isolation, parallelism, cost, or independent review. Subagents add tokens and coordination.
- **Descriptions beat clever prompts:** the description is all Claude knows about a tool. Vague or overlapping ones cause wrong tool choices.
