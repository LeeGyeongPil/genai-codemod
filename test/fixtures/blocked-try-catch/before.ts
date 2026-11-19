import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "test-key");

export async function run(): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const r = await model.generateContent("Tell me something");
  try {
    return r.response.text();
  } catch {
    // the old SDK threw when the safety filter blocked the answer
    return "blocked";
  }
}
