#!/usr/bin/env ts-node-esm
import { chat, chatStream } from "../src/utils/genai";

async function main() {
  const prompt = process.argv.slice(2).join(" ") || "Say hello";
  console.log("→ Prompt:", prompt);

  // non‐streamed
  const text = await chat(prompt, { model: "gemini-2.0-flash" });
  console.log("→ Response (text):", text);

  // streamed (optional)
  console.log("→ Response (stream):");
  for await (const part of chatStream(prompt)) {
    process.stdout.write(part.text ?? part.content ?? "");
  }
  console.log();
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});