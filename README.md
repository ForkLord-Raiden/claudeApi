# claudeApi

Hands-on practice with the Claude Messages API in TypeScript. See [CHEATSHEET.md](CHEATSHEET.md) for the notes.

## Setup

```bash
npm install
```

Set your API key as an environment variable (never commit it):

```powershell
# PowerShell
$env:ANTHROPIC_API_KEY = "your-key-here"
```

```bash
# bash / zsh
export ANTHROPIC_API_KEY="your-key-here"
```

## Scripts

| Command | File | What it shows |
|---|---|---|
| `npm run first-call` | `01-calling-api.ts` | First call, reading the response |
| `npm run params` | `firstCallInputModifications-01.1.ts` | System prompt and `max_tokens` experiments |
| `npm run tools` | `02-tools.ts` | A tool definition and a `tool_use` response |
| `npm run tool-result` | `feedResultsFromTool-03.ts` | Sending a `tool_result` back |
| `npm run agent-loop` | `04-agentLoop.ts` | The agent loop with two tools and an iteration guard |
| `npm run caching` | `05-caching.ts` | Prompt caching, compared across two calls |
| `npm run structured` | `06-structured-response.ts` | Structured output through a tool schema |
| `npm run streaming` | `07-streaming.ts` | Streaming a response |
