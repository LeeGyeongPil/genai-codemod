import { describe, expect, it } from "vitest";
import { transformSource } from "../src/transform/index.js";
import { fixture, read } from "./helpers.js";

const keep = { apiVersion: "keep" } as const;

function transformFixture(name: string, file = "before.ts") {
  const path = fixture(name, file);
  return transformSource(path, read(path), keep);
}

describe("golden transforms", () => {
  it("gemini-basic matches golden output", () => {
    const result = transformFixture("gemini-basic");
    expect(result.output).toBe(read(fixture("gemini-basic", "expected.ts")));
    // the handle declaration is gone, comments survive
    expect(result.output).not.toContain("getGenerativeModel");
    expect(result.output).toContain("// One model handle carries the settings for every call below");
    expect(result.output).toContain("// Client for the Gemini API");
    // settings are flattened into config, never nested
    expect(result.output).not.toMatch(/config:\s*\{[^}]*generationConfig/);
    expect(result.output).toContain("temperature: 0.2");
    // a plain object with a `model` key is not a reference to the handle
    expect(result.output).toContain('const label = { model: "gemini-2.5-flash", note: "label only" };');
    expect(result.output).toContain('apiVersion: "v1beta"');
    expect(result.todos).toEqual([]);
  });

  it("is idempotent: the golden output transforms to itself", () => {
    const path = fixture("gemini-basic", "expected.ts");
    const again = transformSource(path, read(path), keep);
    expect(again.changed).toBe(false);
    expect(again.output).toBe(read(path));
  });

  it("vertex-basic uses vertexai: true, apiVersion v1 and candidates access", () => {
    const { output } = transformFixture("vertex-basic");
    expect(output).toContain('new GoogleGenAI({ vertexai: true, project: "p", location: "us-central1"');
    expect(output).toContain('apiVersion: "v1" })');
    expect(output).toContain("result.candidates?.[0]");
    expect(output).not.toContain("response.candidates");
  });
});

describe("conservative boundaries", () => {
  it("unsafe patterns are reported, not rewritten", () => {
    const path = fixture("unsafe-patterns", "before.ts");
    const before = read(path);
    const result = transformSource(path, before, keep);
    const lineOf = (needle: string) => before.split("\n").findIndex((l) => l.includes(needle)) + 1;

    const byCode = (code: string) => result.todos.filter((t) => t.code === code).map((t) => t.line);
    expect(byCode("dynamic-model-params")).toEqual([lineOf("getGenerativeModel(options)"), lineOf("...defaults")]);
    expect(byCode("handle-escapes")).toEqual([lineOf("return handle;")]);
    expect(byCode("request-options")).toEqual([lineOf("timeout: 5000")]);
    expect(byCode("stream-aggregate")).toEqual([lineOf("return await r.response;")]);
    expect(byCode("server-managers")).toEqual([lineOf("generative-ai/server")]);

    // original text of every reported node is unchanged
    for (const kept of [
      "const dynamicModel = genAI.getGenerativeModel(options);",
      'const spreadModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash", ...defaults });',
      "return handle;",
      'getGenerativeModel({ model: "gemini-2.5-flash" }, { timeout: 5000 });',
      "return await r.response;",
      'import { GoogleAICacheManager } from "@google/generative-ai/server";',
    ]) {
      expect(result.output).toContain(kept);
    }
    // the one handle that was safe is still rewritten
    expect(result.output).toContain("genAI.models.generateContentStream");
  });

  it("reports leftover getGenerativeModel calls again on a rerun", () => {
    const path = fixture("unsafe-patterns", "before.ts");
    const first = transformSource(path, read(path), keep);
    const second = transformSource(path, first.output, keep);
    expect(second.changed).toBe(false);
    expect(second.todos.map((t) => t.code)).toContain("handle-escapes");
  });

  it("ignores files that do not mention a Google SDK", () => {
    const result = transformSource("x.ts", "export const a = 1;\n", keep);
    expect(result).toMatchObject({ changed: false, legacy: false, todos: [], warnings: [] });
  });

  it("rejects files that do not parse", () => {
    expect(() => transformSource("bad.ts", 'import { GoogleGenerativeAI } from "@google/generative-ai"; const = ;', keep)).toThrow(/bad\.ts/);
  });
});

describe("other call shapes", () => {
  const run = (code: string) => transformSource("case.ts", code, keep);

  it("rewrites CommonJS require and keeps quotes", () => {
    const out = run(
      `const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');\nconst g = new GoogleGenerativeAI(k);\nconst t = SchemaType.STRING;\n`,
    ).output;
    expect(out).toContain(`const { GoogleGenAI, Type } = require('@google/genai');`);
    expect(out).toContain(`new GoogleGenAI({ apiKey: k, apiVersion: "v1beta" })`);
    expect(out).toContain("const t = Type.STRING;");
  });

  it("merges GoogleGenerativeAI and VertexAI into one GoogleGenAI import", () => {
    const out = run(
      `import { GoogleGenerativeAI } from "@google/generative-ai";\nimport { VertexAI } from "@google-cloud/vertexai";\nconst a = new GoogleGenerativeAI("k");\nconst b = new VertexAI({ project: "p", location: "l" });\n`,
    ).output;
    expect(out.match(/import \{ GoogleGenAI \}/g)).toHaveLength(1);
    expect(out).toContain("new GoogleGenAI({ vertexai: true, project: \"p\", location: \"l\", apiVersion: \"v1\" })");
  });

  it("rewrites countTokens, embedContent and function calls", () => {
    const out = run(
      [
        `import { GoogleGenerativeAI } from "@google/generative-ai";`,
        `const genAI = new GoogleGenerativeAI("k");`,
        `const m = genAI.getGenerativeModel({ model: "gemini-embedding-001" });`,
        `export async function f() {`,
        `  const n = await m.countTokens("hello");`,
        `  const e = await m.embedContent("hello");`,
        `  const r = await m.generateContent("hi");`,
        `  return [n.totalTokens, e.embedding.values, r.response.functionCalls(), r.response.candidates];`,
        `}`,
        ``,
      ].join("\n"),
    ).output;
    expect(out).toContain('genAI.models.countTokens({ model: "gemini-embedding-001", contents: "hello" })');
    expect(out).toContain('genAI.models.embedContent({ model: "gemini-embedding-001", contents: "hello" })');
    expect(out).toContain("e.embeddings[0].values");
    expect(out).toContain("r.functionCalls");
    expect(out).toContain("r.candidates]");
    expect(out).not.toContain("getGenerativeModel");
  });

  it("reports Vertex function schemas and preview usage", () => {
    const result = run(
      [
        `import { VertexAI, FunctionDeclarationSchemaType } from "@google-cloud/vertexai";`,
        `const v = new VertexAI({ project: "p", location: "l" });`,
        `const p = v.preview;`,
        `const tools = [{ function_declarations: [{ name: "x", parameters: { type: FunctionDeclarationSchemaType.OBJECT } }] }];`,
        ``,
      ].join("\n"),
    );
    const codes = result.todos.map((t) => t.code);
    expect(codes).toContain("vertex-preview");
    expect(codes).toContain("vertex-function-schema");
  });

  it("leaves a chat that is not stored in a const and reports it", () => {
    const result = run(
      [
        `import { GoogleGenerativeAI } from "@google/generative-ai";`,
        `const genAI = new GoogleGenerativeAI("k");`,
        `const m = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });`,
        `export const holder: { chat?: unknown } = {};`,
        `holder.chat = m.startChat();`,
        ``,
      ].join("\n"),
    );
    expect(result.todos.map((t) => t.code)).toEqual(["handle-escapes"]);
    expect(result.output).toContain("m.startChat()");
  });
});
