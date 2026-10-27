import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: "getWeather",
    description:
      "Get current weather for a city, use this whenever the user asks about weather",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name eg bangalore" },
      },
      required: ["city"],
    },
  },
];

function getWeather(city: string): string {
  return `32°C, humid in ${city}`; // fake data, just proving the plumbing
}
const response = await client.messages.create({
  model: "claude-haiku-5-5",
  max_tokens: 3000,
  tools,
  messages: [
    {
      role: "user",
      content: "Can you tell me where I am and whats the weather i mumbai?",
    },
  ],
});
console.log(response)
const toolUse = response.content.find(
  (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
);
if (!toolUse) throw new Error("no tool call");

const { city } = toolUse.input as { city: string };
const result = getWeather(city);

const followUp = await client.messages.create({
  model: "claude-haiku-5-5",
  max_tokens: 2000,
  tools,
  messages: [
    { role: "user", content: "What's the weather in Bangalore right now?" },
    { role: "assistant", content: response.content },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUse.id, content: result }],
    },
  ],
});

console.log(followUp.stop_reason);
for (const b of followUp.content) if (b.type === "text") console.log(b.text);

console.log(followUp)
//We need to feed the result of tool to get the final answer