import { VertexAI } from "@google-cloud/vertexai";

// `verify --vertex` passes { authClient }; in production Application Default Credentials apply
export async function run({ authClient }: { authClient?: unknown } = {}): Promise<string | undefined> {
  const vertexAI = new VertexAI({
    project: "demo-project",
    location: "us-central1",
    googleAuthOptions: { authClient } as never,
  });
  const model = vertexAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.2 },
  });
  const result = await model.generateContent("Name one planet.");
  return result.response.candidates?.[0]?.content?.parts?.[0]?.text;
}
