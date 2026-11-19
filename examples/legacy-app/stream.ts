import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "test-key");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Print an answer piece by piece
export async function run(): Promise<string> {
  const result = await model.generateContentStream("Count from one to three.");
  let text = "";
  for await (const chunk of result.stream) {
    text += chunk.text();
  }
  return text;
}
