export type MockResponseKind = "ok" | "blocked";

const usage = { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 };

const okBody = {
  candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP", index: 0 }],
  usageMetadata: usage,
};

/** A response the safety filter stopped: no text, finishReason SAFETY. */
const blockedBody = {
  candidates: [
    {
      finishReason: "SAFETY",
      index: 0,
      safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", probability: "HIGH", blocked: true }],
    },
  ],
  usageMetadata: { promptTokenCount: 3, totalTokenCount: 3 },
};

function sse(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join("");
}

/** Canned reply for a request path. Streams are server-sent events with two chunks. */
export function cannedResponse(kind: MockResponseKind, path: string): Response {
  const json = { "content-type": "application/json" };
  if (path.endsWith(":streamGenerateContent")) {
    const chunks =
      kind === "blocked"
        ? [blockedBody]
        : [
            { candidates: [{ content: { role: "model", parts: [{ text: "o" }] }, index: 0 }] },
            { candidates: [{ content: { role: "model", parts: [{ text: "k" }] }, finishReason: "STOP", index: 0 }], usageMetadata: usage },
          ];
    return new Response(sse(chunks), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (path.endsWith(":countTokens")) return new Response(JSON.stringify({ totalTokens: 7 }), { status: 200, headers: json });
  if (/:(batchEmbedContents|embedContent)$/.test(path)) {
    // Both response shapes so the old and the new SDK can parse the same canned body.
    const values = [0.1, 0.2, 0.3];
    return new Response(JSON.stringify({ embedding: { values }, embeddings: [{ values }] }), { status: 200, headers: json });
  }
  return new Response(JSON.stringify(kind === "blocked" ? blockedBody : okBody), { status: 200, headers: json });
}
