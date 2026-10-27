import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = client.messages.stream({
  model: "claude-haiku-5-5",
  max_tokens: 2000,
  messages: [
    { role: "user", content: "Explain how an agent loop works, in about 200 words." },
  ],
});

stream.on("text", (text) => process.stdout.write(text));

const response = await stream.finalMessage();
console.log(`\n--------------------------------------------------`)
console.log(response)
console.log(`--------------------------------------------------`)
console.log("\n\nstop_reason:", response.stop_reason);
console.log(response.usage);