import { describe, expect, it } from "vitest";
import { verifyFiles } from "../src/verify/index.js";
import { VerifyError } from "../src/verify/errors.js";
import { fixture, runCli, scratch, transformToScratch } from "./helpers.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ok = { entry: "run", response: "ok", vertex: false } as const;
const blocked = { entry: "run", response: "blocked", vertex: false } as const;
const vertex = { entry: "run", response: "ok", vertex: true } as const;
const VERTEX_V1 = "/v1/projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent";

describe("request equivalence", () => {
  it("keep mode: gemini-basic sends the same requests, streams included", async () => {
    const before = fixture("gemini-basic", "before.ts");
    const { out, result } = transformToScratch(before, "keep");
    expect(result.output).toContain('apiVersion: "v1beta"');
    const verified = await verifyFiles(before, out, ok, "en");
    expect(verified.differences).toEqual([]);
    const json = JSON.parse(verified.json);
    expect(json.result).toBe("MATCH");
    const paths = json.requests.before.map((r: { path: string }) => r.path);
    expect(paths).toContain("/v1beta/models/gemini-2.5-flash:generateContent");
    expect(paths).toContain("/v1beta/models/gemini-2.5-flash:streamGenerateContent");
    expect(json.requests.after).toHaveLength(json.requests.before.length);
    expect(verified.text).toContain("systemInstruction.role");
  });

  it("sdk-default api version changes request path", async () => {
    const before = fixture("gemini-basic", "before.ts");
    const { out, result } = transformToScratch(before, "sdkdef", { apiVersion: "sdk-default" });
    expect(result.output).not.toContain("apiVersion");
    expect(result.warnings.map((w) => w.code)).toContain("api-version-default-changed");
    const verified = await verifyFiles(before, out, ok, "en");
    expect(verified.match).toBe(false);
    const diff = verified.differences.find((d) => d.path === "request[0].path");
    expect(diff?.before).toBe('"/v1beta/models/gemini-2.5-flash:generateContent"');
    expect(diff?.after).toBe('"/v1/models/gemini-2.5-flash:generateContent"');

    const cli = await runCli(["verify", before, out]);
    expect(cli.code).toBe(1);
    expect(cli.stdout).toContain('request[0].path: "/v1beta/');
  });

  it("vertex keeps v1 endpoint", async () => {
    const before = fixture("vertex-basic", "before.ts");
    const kept = transformToScratch(before, "vertex-keep");
    const verified = await verifyFiles(before, kept.out, vertex, "en");
    expect(verified.differences).toEqual([]);
    const json = JSON.parse(verified.json);
    expect(json.requests.before[0].path).toBe(VERTEX_V1);
    expect(json.requests.after[0].path).toBe(VERTEX_V1);

    const dflt = transformToScratch(before, "vertex-default", { apiVersion: "sdk-default" });
    expect(dflt.result.warnings.map((w) => w.code)).toContain("vertex-api-version-default-changed");
    const changed = await verifyFiles(before, dflt.out, vertex, "en");
    expect(changed.match).toBe(false);
    expect(changed.differences.find((d) => d.path === "request[0].path")?.after).toContain("/v1beta1/projects/p/");
    expect((await runCli(["verify", before, dflt.out, "--vertex"])).code).toBe(1);
    expect((await runCli(["verify", before, kept.out, "--vertex"])).code).toBe(0);
  });

  it("blocked response exposes text() semantics change", async () => {
    const before = fixture("blocked-try-catch", "before.ts");
    const { out, result } = transformToScratch(before, "blocked");
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0]).toMatchObject({ code: "text-throws-on-block", line: 9 });
    expect((await runCli([before, "--out-dir", scratch("blocked-cli")])).code).toBe(1);

    const same = await verifyFiles(before, out, ok, "en");
    expect(same.match).toBe(true);
    const diff = await verifyFiles(before, out, blocked, "en");
    expect(diff.match).toBe(false);
    expect(diff.differences).toEqual([{ path: "return", before: '"blocked"', after: "undefined" }]);
  });

  it("nested generationConfig is silently dropped", async () => {
    const nested = fixture("half-migrated", "input.ts");
    const flat = fixture("half-migrated", "flat.ts");
    const { result } = transformToScratch(nested, "nested");
    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: "nested-generation-config", line: 10 });
    const verified = await verifyFiles(nested, flat, ok, "en");
    expect(verified.match).toBe(false);
    expect(verified.differences.map((d) => d.path)).toEqual(["request[0].body.generationConfig.temperature"]);
    expect(verified.differences[0]).toMatchObject({ before: "undefined", after: "0.2" });
  });
});

describe("known endpoint change", () => {
  it("embedContent is rewritten and verify shows that the new SDK uses batchEmbedContents", async () => {
    const dir = scratch("embed");
    const before = join(dir, "before.ts");
    writeFileSync(
      before,
      [
        'import { GoogleGenerativeAI } from "@google/generative-ai";',
        'const genAI = new GoogleGenerativeAI("k");',
        'const m = genAI.getGenerativeModel({ model: "gemini-embedding-001" });',
        "export async function run() {",
        '  const e = await m.embedContent("hello");',
        "  return e.embedding.values;",
        "}",
        "",
      ].join("\n"),
    );
    const { out } = transformToScratch(before, "embed-out");
    const verified = await verifyFiles(before, out, ok, "en");
    expect(verified.match).toBe(false);
    const pathDiff = verified.differences.find((d) => d.path === "request[0].path");
    expect(pathDiff?.before).toContain(":embedContent");
    expect(pathDiff?.after).toContain(":batchEmbedContents");
    // the returned vector is still the same
    expect(verified.differences.some((d) => d.path.startsWith("return"))).toBe(false);
  });
});

describe("verify error handling", () => {
  it("fails with a fix hint when the entry function is missing", async () => {
    const dir = scratch("noentry");
    const file = join(dir, "x.ts");
    writeFileSync(file, 'import { GoogleGenAI } from "@google/genai";\nexport const notAFunction = 1;\n');
    await expect(verifyFiles(file, file, ok, "en")).rejects.toBeInstanceOf(VerifyError);
    const cli = await runCli(["verify", file, file]);
    expect(cli.code).toBe(2);
    expect(cli.stderr).toContain('does not export an async function named "run"');
    const custom = await runCli(["verify", file, file, "--entry", "notAFunction"]);
    expect(custom.code).toBe(2);
  });

  it("explains how to install a missing SDK", async () => {
    const dir = scratch("nosdk");
    const file = join(dir, "x.ts");
    writeFileSync(file, 'import "@google/does-not-exist-sdk";\nexport async function run() {}\n');
    const cli = await runCli(["verify", file, file]);
    expect(cli.code).toBe(2);
    expect(cli.stderr).toContain("@google/does-not-exist-sdk");
    expect(cli.stderr).toContain("npm install -D");
  });

  it("rejects bad arguments with exit 2", async () => {
    expect((await runCli(["verify", "only-one.ts"])).code).toBe(2);
    expect((await runCli(["verify", "a.ts", "b.ts", "--response", "weird"])).code).toBe(2);
    expect((await runCli(["verify", "nope-a.ts", "nope-b.ts"])).code).toBe(2);
  });

  it("leaves no temporary files behind", async () => {
    const before = fixture("gemini-basic", "before.ts");
    const { out } = transformToScratch(before, "cleanup");
    await verifyFiles(before, out, ok, "en");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(fixture("gemini-basic")).filter((f) => f.startsWith(".genai-codemod-"))).toEqual([]);
  });
});
