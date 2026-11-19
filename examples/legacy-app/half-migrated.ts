import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "test-key", apiVersion: "v1beta" });

// Ported by hand: the old nesting was kept, so the temperature never reaches the API
export async function run(): Promise<string | undefined> {
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "Write a haiku.",
    config: { generationConfig: { temperature: 0.9 } },
  });
  return result.text;
}
