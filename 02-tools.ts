import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
//Basically it has some inbuilt tools for the rest we write custom tools and then manually invoke em
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

console.log(response);

//So basically this returns its thought we need to make another call
