import { GoogleGenAI } from "@google/genai";

export const GEMINI_API_KEY: string =
  (process.env["GEMINI_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "");
// Non-null assertion not needed as we default to empty string

if (!GEMINI_API_KEY) {
  console.error("⚠️  Missing GEMINI_API_KEY or OPENAI_API_KEY");
}

export const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

/**
 * Simple text‑only wrapper (non‑streaming)
 */
export async function chat(
  prompt: string,
  opts: { model?: string } = {}
): Promise<string> {
  const response = await genai.models.generateContent({
    model: opts.model ?? "gemini-2.0-flash",
    contents: prompt,
  });
  return response.text;
}

/**
 * Streaming wrapper yielding individual parts
 */
export async function* chatStream(
  prompt: string,
  opts: { model?: string } = {}
) {
  // Await the stream promise to get an async generator
  const stream = await genai.models.generateContentStream({
    model: opts.model ?? "gemini-2.0-flash",
    contents: prompt,
  });
  for await (const part of stream) {
    yield part;
  }
}