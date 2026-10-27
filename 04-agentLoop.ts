import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

const MAX_ITERATIONS = 8;

const tools: Anthropic.Tool[] = [
  {
    name: "getWeather",
    description: "gets current weather",
    input_schema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
  {
    name: "celsiusToFahrenheit",
    description:
      "Convert a temperature from Celsius to Fahrenheit. Use for any conversion; do not calculate yourself.",
    input_schema: {
      type: "object",
      properties: {
        celsius: { type: "number", description: "Temperature in Celsius" },
      },
      required: ["celsius"],
    },
  },
];
//Custom deterministic functions created so that I can build my own code to invoke different apis as tools
const handlers: Record<string, (input: any) => Promise<string> | string> = {
  getWeather: async ({ city }) => {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
    ).then((r) => r.json());
    const place = geo.results?.[0];
    if (!place) throw new Error(`City not found: ${city}`);

    const wx = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m`,
    ).then((r) => r.json());

    return `${wx.current.temperature_2m}°C, humidity ${wx.current.relative_humidity_2m}% in ${place.name}`;
  },
  celsiusToFahrenheit: ({ celsius }) => String((celsius * 9) / 5 + 32),
};

async function runAgent(question: string) {
  const message: Anthropic.MessageParam[] = [
    { role: "user", content: question },
  ];
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 2000,
      tools,
      messages: message,
    });
    if (res.stop_reason !== "tool_use") return res;
    message.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      //lets see the tool it called what did it call
      console.log(`----------------------Logging tools---------------------`);
      console.log("tool called:", block.name, JSON.stringify(block.input));
      console.log(`-------------------------------------------`);
      const handler = handlers[block.name];
      if (!handler) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }
      try {
        const output = await handler(block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });
      } catch (e) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(e),
          is_error: true,
        });
      }
    }
    message.push({ role: "user", content: results }); // ONE message, all results
  }
  throw new Error("Hit max iterations");
}

const final = await runAgent("What's the weather in ullal, in Fahrenheit?");

for (const b of final.content) {
  if (b.type === "text") {
    console.log(
      `----------------------Logging Final Content---------------------`,
    );
    console.log(b.text);
    console.log(
      `----------------------------------------------------------------`,
    );
  }
}
console.log(`-------------------------------Result of final---------------------`)
console.log(final)