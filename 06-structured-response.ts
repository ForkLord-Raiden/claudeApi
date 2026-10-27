import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: "record_order",
    description:
      "Record the structured details of an order found in the user's message. Always call this with the extracted data.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        item: { type: "string" },
        quantity: { type: "integer" },
        urgent: { type: "boolean" },
      },
      required: ["customer_name", "item", "quantity", "urgent"],
      additionalProperties: false,
    },
  },
];

const res = await client.messages.create({
  model: "claude-haiku-5-5",
  max_tokens: 2000,
  tools,
   tool_choice: { type: "tool", name: "record_order" },
  messages: [
    {
      role: "user",
      content: "Hi, this is Priya. Please send 3 notebooks ASAP, I need them by tomorrow.",
    },
  ],
});

console.log(`----------------Response-----------------------`)
console.log(res);

console.log(`----------------------------------------------`)
console.log(res.stop_reason);
const block = res.content.find((b) => b.type === "tool_use");
console.log(block && block.type === "tool_use" ? block.input : "no tool call");