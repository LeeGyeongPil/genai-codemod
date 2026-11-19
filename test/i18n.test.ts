import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { messageKeys, resolveLang, t } from "../src/i18n.js";
import { copyTree, fixture, root, runCli, scratch, transformToScratch } from "./helpers.js";

describe("language resolution and identical message keys", () => {
  it("--lang beats GENAI_CODEMOD_LANG beats LC_ALL beats LC_MESSAGES beats LANG", () => {
    expect(resolveLang("ko", { GENAI_CODEMOD_LANG: "en", LC_ALL: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { GENAI_CODEMOD_LANG: "ko", LC_ALL: "en_US.UTF-8" })).toBe("ko");
    expect(resolveLang(undefined, { LC_ALL: "ko_KR.UTF-8", LC_MESSAGES: "en_US", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { LC_MESSAGES: "ko_KR.UTF-8", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { LANG: "ko_KR.UTF-8" })).toBe("ko");
    expect(resolveLang(undefined, { LANG: "ja_JP.UTF-8" })).toBe("en");
    expect(resolveLang(undefined, {})).toBe("en");
    expect(resolveLang("en", { LANG: "ko_KR.UTF-8" })).toBe("en");
  });

  it("en and ko define exactly the same message keys", () => {
    expect(messageKeys("ko")).toEqual(messageKeys("en"));
    // every TODO/warning code the transform can emit has a message in both languages
    for (const code of [
      "dynamic-model-params", "handle-escapes", "text-throws-on-block", "stream-aggregate", "server-managers",
      "request-options", "vertex-function-schema", "vertex-preview", "unsupported-usage", "unsupported-import-form",
      "cross-module", "client-exported",
    ]) {
      expect(messageKeys("en")).toContain(`todo.${code}`);
    }
    for (const code of [
      "api-version-pinned", "api-version-default-changed", "vertex-api-version-default-changed",
      "nested-generation-config", "node-engine", "duplicate-genai", "client-shared",
    ]) {
      expect(messageKeys("en")).toContain(`warn.${code}`);
    }
    expect(t("ko", "mode.dry")).not.toBe(t("en", "mode.dry"));
  });

  it("help, summary and verify switch language with --lang", async () => {
    const en = await runCli(["--help", "--lang", "en"]);
    const ko = await runCli(["--help", "--lang", "ko"]);
    expect(en.stdout).toContain("Usage:");
    expect(ko.stdout).toContain("사용법:");

    const cwd = scratch("i18n-app");
    copyTree(join(root, "examples", "legacy-app"), join(cwd, "app"));
    const sumEn = await runCli(["app", "--lang", "en"], { LANG: "ko_KR.UTF-8" }, cwd);
    const sumKo = await runCli(["app", "--lang", "ko"], { LANG: "en_US.UTF-8" }, cwd);
    expect(sumEn.stdout).toContain("Summary:");
    expect(sumKo.stdout).toContain("요약:");

    const before = fixture("gemini-basic", "before.ts");
    const { out } = transformToScratch(before, "i18n-verify");
    const vEn = await runCli(["verify", before, out, "--lang", "en"]);
    const vKo = await runCli(["verify", before, out, "--lang", "ko"]);
    expect(vEn.stdout).toContain("Result: MATCH");
    expect(vKo.stdout).toContain("결과: MATCH");
  });

  it("the environment variable and LANG choose the language when --lang is absent", async () => {
    expect((await runCli(["--help"], { GENAI_CODEMOD_LANG: "ko" })).stdout).toContain("사용법:");
    expect((await runCli(["--help"], { LANG: "ko_KR.UTF-8" })).stdout).toContain("사용법:");
    expect((await runCli(["--help"], { GENAI_CODEMOD_LANG: "en", LANG: "ko_KR.UTF-8" })).stdout).toContain("Usage:");
    expect((await runCli(["--help"], { LANG: "de_DE.UTF-8" })).stdout).toContain("Usage:");
  });

  it("report codes do not depend on the language", async () => {
    const cwd = scratch("i18n-report");
    copyTree(join(root, "examples", "legacy-app"), join(cwd, "app"));
    await runCli(["app", "--lang", "en", "--report", "en.json"], {}, cwd);
    await runCli(["app", "--lang", "ko", "--report", "ko.json"], {}, cwd);
    const { readFileSync } = await import("node:fs");
    const load = (name: string) => JSON.parse(readFileSync(join(cwd, name), "utf8"));
    const codes = (r: { files: Array<{ path: string; todos: Array<{ code: string; line: number }>; warnings: Array<{ code: string; line: number }> }> }) =>
      r.files.map((f) => ({ path: f.path, todos: f.todos.map((i) => [i.code, i.line]), warnings: f.warnings.map((i) => [i.code, i.line]) }));
    const en = load("en.json");
    const ko = load("ko.json");
    expect(codes(ko)).toEqual(codes(en));
    expect(ko.files[0].todos[0]?.message ?? ko.files.flatMap((f: { todos: Array<{ message: string }> }) => f.todos)[0].message).not.toBe(
      en.files.flatMap((f: { todos: Array<{ message: string }> }) => f.todos)[0].message,
    );
  });
});
