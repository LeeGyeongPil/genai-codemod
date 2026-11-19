import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "test-key", apiVersion: "v1beta" });

export async function run(): Promise<string | undefined> {
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "Say hi",
    config: { temperature: 0.2 },
  });
  return result.text;
}
