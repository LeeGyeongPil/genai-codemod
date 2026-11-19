import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAICacheManager } from "@google/generative-ai/server";

const genAI = new GoogleGenerativeAI("test-key");
const defaults = { temperature: 0.1 };
const options = { model: "gemini-2.5-flash" };

// dynamic-model-params: options come from a variable
const dynamicModel = genAI.getGenerativeModel(options);

// dynamic-model-params: spread inside the options
const spreadModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash", ...defaults });

// handle-escapes: the handle is returned to the caller
function makeModel() {
  const handle = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  return handle;
}

// request-options: a timeout is passed as the second argument
const slowModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }, { timeout: 5000 });

// stream-aggregate: waits for the aggregated stream response
const streamModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
export async function aggregate() {
  const r = await streamModel.generateContentStream("hi");
  for await (const c of r.stream) void c;
  return await r.response;
}

export const manager = new GoogleAICacheManager("test-key");
export const unused = [dynamicModel, spreadModel, makeModel, slowModel];
