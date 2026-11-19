import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "test-key");

// Summarize a text and keep a short follow-up chat (the verify entry point)
export async function run(): Promise<string[]> {
  const out: string[] = [];

  // Settings live on the model handle in the old SDK
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: "Summarize in one sentence.",
    generationConfig: { temperature: 0.3, maxOutputTokens: 128 },
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ],
  });

  const summary = await model.generateContent("Summarize: the quick brown fox jumps over the lazy dog.");
  out.push(summary.response.text());

  const chat = model.startChat({ history: [] });
  const follow = await chat.sendMessage("Now shorter, please.");
  out.push(follow.response.text());
  out.push(String(follow.response.usageMetadata?.totalTokenCount));
  return out;
}
