import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";

// Client for the Gemini API (works without a real key under the verify mock)
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "test-key", apiVersion: "v1beta" });

export async function run(): Promise<string[]> {
  const out: string[] = [];

  // One model handle carries the settings for every call below

  // A plain object that happens to have a `model` key must not be mistaken for the handle
  const label = { model: "gemini-2.5-flash", note: "label only" };
  out.push(label.model);

  const result = await genAI.models.generateContent({ model: "gemini-2.5-flash", contents: "Say hi", config: { systemInstruction: "You are terse.", temperature: 0.2, maxOutputTokens: 64, safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    ] } });
  out.push(result.text);

  const chat = genAI.chats.create({ model: "gemini-2.5-flash", history: [
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi" }] },
    ], config: { systemInstruction: "You are terse.", temperature: 0.2, maxOutputTokens: 64, safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    ] } });
  const reply = await chat.sendMessage({ message: "How are you?" });
  out.push(reply.text);

  const streamed = await genAI.models.generateContentStream({ model: "gemini-2.5-flash", contents: "Count to two", config: { systemInstruction: "You are terse.", temperature: 0.2, maxOutputTokens: 64, safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    ] } });
  let joined = "";
  for await (const chunk of streamed) {
    joined += chunk.text;
  }
  out.push(joined);

  out.push(String(result.usageMetadata?.totalTokenCount));
  return out;
}
