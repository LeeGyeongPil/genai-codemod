import { VertexAI } from "@google-cloud/vertexai";

// The entry function receives { authClient } from `verify --vertex`; in production Application Default Credentials are used
export async function run({ authClient }: { authClient?: unknown } = {}): Promise<string | undefined> {
  const vertexAI = new VertexAI({
    project: "p",
    location: "us-central1",
    googleAuthOptions: { authClient } as never,
  });
  const model = vertexAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.2 },
  });
  const result = await model.generateContent("Say hi");
  return result.response.candidates?.[0]?.content?.parts?.[0]?.text;
}
