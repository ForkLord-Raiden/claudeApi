import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
    model:"claude-haiku-5-5",
    max_tokens:300,
    messages:[{role:"user", content:"Explain what an api is in one sentence."}]
})

console.log(JSON.stringify(response,null,2));

