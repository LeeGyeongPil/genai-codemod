import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "test-key");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// The old SDK throws from text() when the safety filter blocks the answer
export async function run(): Promise<string> {
  const result = await model.generateContent("Describe a thunderstorm.");
  try {
    return result.response.text();
  } catch {
    return "blocked";
  }
}
