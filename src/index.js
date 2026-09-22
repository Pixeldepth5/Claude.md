#!/usr/bin/env node
import Anthropic from "@anthropic-ai/sdk";
import readline from "readline";
import { toolDefinitions, runTool } from "./tools.js";

const MODEL = process.env.JARVIS_MODEL || "claude-sonnet-5";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY before running Jarvis.");
  process.exit(1);
}

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Jarvis, a concise personal assistant. Use the available tools when a
request needs real data (time, weather, arithmetic) or persistence (notes, reminders).
Do not claim to have taken an action unless you actually called the corresponding tool.
Keep replies short and direct.`;

const messages = [];

async function runTurn(userText) {
  messages.push({ role: "user", content: userText });

  // Loop until the model stops requesting tools.
  for (;;) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((block) => block.type === "tool_use");
    const textBlocks = response.content.filter((block) => block.type === "text");

    for (const block of textBlocks) {
      if (block.text.trim()) console.log(`Jarvis: ${block.text.trim()}`);
    }

    if (toolUses.length === 0) return;

    const toolResults = [];
    for (const use of toolUses) {
      const result = await runTool(use.name, use.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log("Jarvis online. Type your request, or 'exit' to quit.");
rl.setPrompt("You: ");
rl.prompt();

rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return rl.prompt();
  if (["exit", "quit"].includes(text.toLowerCase())) {
    rl.close();
    return;
  }
  try {
    await runTurn(text);
  } catch (err) {
    console.error("Error:", err.message);
  }
  rl.prompt();
});

rl.on("close", () => {
  console.log("Jarvis offline.");
  process.exit(0);
});
