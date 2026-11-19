import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

// Client for the Gemini API (works without a real key under the verify mock)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "test-key");

export async function run(): Promise<string[]> {
  const out: string[] = [];

  // One model handle carries the settings for every call below
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: "You are terse.",
    generationConfig: { temperature: 0.2, maxOutputTokens: 64 },
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    ],
  });

  // A plain object that happens to have a `model` key must not be mistaken for the handle
  const label = { model: "gemini-2.5-flash", note: "label only" };
  out.push(label.model);

  const result = await model.generateContent("Say hi");
  out.push(result.response.text());

  const chat = model.startChat({
    history: [
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi" }] },
    ],
  });
  const reply = await chat.sendMessage("How are you?");
  out.push(reply.response.text());

  const streamed = await model.generateContentStream("Count to two");
  let joined = "";
  for await (const chunk of streamed.stream) {
    joined += chunk.text();
  }
  out.push(joined);

  out.push(String(result.response.usageMetadata?.totalTokenCount));
  return out;
}
