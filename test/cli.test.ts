import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { root, runCli, scratch } from "./helpers.js";

const hashTree = (dir: string): string => {
  const hash = createHash("sha256");
  for (const name of readdirSync(dir).sort()) hash.update(name).update(readFileSync(join(dir, name)));
  return hash.digest("hex");
};

function copyApp(name: string): string {
  const dir = scratch(name);
  cpSync(join(root, "examples", "legacy-app"), join(dir, "app"), { recursive: true });
  return dir;
}

describe("CLI", () => {
  it("dry-run, write, idempotent rerun and report", async () => {
    const cwd = copyApp("cli-flow");
    const app = join(cwd, "app");
    const sourceHash = hashTree(app);

    // dry run: prints a diff and a summary, touches nothing
    const dry = await runCli(["app"], {}, cwd);
    expect(hashTree(app)).toBe(sourceHash);
    expect(dry.stdout).toContain("--- a/app/gemini.ts");
    expect(dry.stdout).toContain("+const genAI = new GoogleGenAI(");
    expect(dry.stdout).toMatch(/Summary: 5 files scanned, 4 files changed \(dry run, nothing written\), 1 TODOs/);
    expect(dry.code).toBe(1); // TODO text-throws-on-block

    // write + report
    const written = await runCli(["app", "--write", "--report", "r.json"], {}, cwd);
    expect(written.code).toBe(1);
    expect(hashTree(app)).not.toBe(sourceHash);
    const report = JSON.parse(readFileSync(join(cwd, "r.json"), "utf8"));
    expect(report.tool).toBe("genai-codemod");
    expect(report.apiVersionMode).toBe("keep");
    expect(report.summary).toMatchObject({ filesScanned: 5, filesChanged: 4, todos: 1 });
    expect(report.summary.warnings).toBeGreaterThanOrEqual(5);
    const blocked = report.files.find((f: { path: string }) => f.path === join("app", "blocked.ts"));
    expect(blocked.todos).toEqual([expect.objectContaining({ code: "text-throws-on-block", line: 10 })]);
    const pkg = report.files.find((f: { path: string }) => f.path === join("app", "package.json"));
    expect(pkg.warnings.map((w: { code: string }) => w.code)).toContain("node-engine");

    // rerun on the written result: nothing left to change, exit 0 (idempotent)
    const rerun = await runCli(["app"], {}, cwd);
    expect(rerun.stdout).toContain("0 files changed");
    // only the marker comment of the blocked-answer TODO is left (see regressions.test.ts)
    expect(rerun.stdout).toContain("1 TODOs");
    expect(rerun.code).toBe(1);
  });

  it("--out-dir keeps the originals", async () => {
    const cwd = copyApp("cli-outdir");
    const before = hashTree(join(cwd, "app"));
    const res = await runCli(["app", "--out-dir", "out"], {}, cwd);
    expect(hashTree(join(cwd, "app"))).toBe(before);
    expect(existsSync(join(cwd, "out", "gemini.ts"))).toBe(true);
    expect(res.stdout).toContain("(written to out)");
  });

  it("a missing path exits 2", async () => {
    const res = await runCli(["does-not-exist"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("Path not found: does-not-exist");
  });

  it("rejects bad options with exit 2 and a fix hint", async () => {
    expect((await runCli(["--api-version", "v9"])).stderr).toContain("keep or sdk-default");
    expect((await runCli(["--write", "--out-dir", "x"])).code).toBe(2);
    expect((await runCli(["--lang", "fr"])).code).toBe(2);
    expect((await runCli(["--no-such-flag"])).code).toBe(2);
  });

  it("exits 2 when a file cannot be parsed but still handles the others", async () => {
    const cwd = scratch("cli-parse");
    writeFileSync(join(cwd, "bad.ts"), 'import { GoogleGenerativeAI } from "@google/generative-ai"; const = ;\n');
    writeFileSync(join(cwd, "good.ts"), 'import { GoogleGenerativeAI } from "@google/generative-ai";\nexport const g = new GoogleGenerativeAI("k");\n');
    const res = await runCli(["."], {}, cwd);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("Could not parse bad.ts");
    expect(res.stdout).toContain("--- a/good.ts");
  });

  it("skips node_modules, dist, build and hidden folders", async () => {
    const cwd = scratch("cli-skip");
    const legacy = 'import { GoogleGenerativeAI } from "@google/generative-ai";\nexport const g = new GoogleGenerativeAI("k");\n';
    for (const dir of ["node_modules", "dist", "build", ".hidden", "src"]) {
      scratchFile(join(cwd, dir, "a.ts"), legacy);
    }
    const res = await runCli(["."], {}, cwd);
    expect(res.stdout).toContain("1 files scanned");
    expect(res.stdout).toContain("src/a.ts");
  });

  it("the built bin prints its version", () => {
    const dist = join(root, "dist", "cli.js");
    if (!existsSync(dist)) return; // built by `npm test` via pretest
    const out = spawnSync(process.execPath, [dist, "--version"], { encoding: "utf8" });
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

function scratchFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
