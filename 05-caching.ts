import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const LONG = Array.from(
  { length: 300 },
  (_, i) =>
    `Policy ${i}: refunds for order class ${i} are handled by team ${i % 7} within ${(i % 30) + 1} days.`,
).join("\n");

async function ask() {
  const response = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 2000,
    //This is a cache breakpoint whenever we read this shit about it being an exact byte by byte match of prefix then it is saying the system prompt which is cached should be same, user question can vary also wtf ttl can only be 5m or 1h , I thought it gave some flexibility from 5m to 1hr but nooo you have only 2 options
    system: [
      {
        type: "text",
        text: LONG,
        cache_control: { type: "ephemeral", ttl: "5m" },
      },
    ],
    messages: [{ role: "user", content: "Which team handles order class 42?" }],
  });
  console.log(`-------------Response----------------`);
  console.log(response);
  console.log(`-----------------------------------`);
  console.log(`------------------Usage Information ---------------`);
  const u = response.usage;
  console.log({
    input: u.input_tokens,
    cache_write: u.cache_creation_input_tokens,
    cache_read: u.cache_read_input_tokens,
    output: u.output_tokens,
  });
}

await ask(); // first call: writes the cache
await ask(); // second call, within ~5 minutes: should read it
