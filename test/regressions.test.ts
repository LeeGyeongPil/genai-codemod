import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { byName, collectFiles, VERIFY_TEMP_PREFIX } from "../src/project.js";
import { transformSource } from "../src/transform/index.js";
import { verifyFiles } from "../src/verify/index.js";
import { MAX_TIMEOUT_SECONDS } from "../src/verify/run.js";
import { CHILD, fixture, read, root, runCli, scratch } from "./helpers.js";

const ok = { entry: "run", response: "ok", vertex: false } as const;

describe("demo script follows the CLI language (Q-1)", () => {
  const demo = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["scripts/demo.mjs"], {
      ...CHILD,
      cwd: root,
      env: { PATH: process.env["PATH"] ?? "", ...env },
    });

  it("GENAI_CODEMOD_LANG=ko gives Korean step titles and no English ones", () => {
    const res = demo({ GENAI_CODEMOD_LANG: "ko", LANG: "en_US.UTF-8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("=== 1. 파일 하나로 드라이런");
    expect(res.stdout).toContain("완료.");
    expect(res.stdout).not.toContain("=== 1. Dry run");
    expect(res.stdout).not.toContain("Done.");
    expect(res.stdout).toContain("요약:");
  }, 120_000);

  it("LANG=ko_KR.UTF-8 alone is honoured too, and the default is English", () => {
    const ko = demo({ LANG: "ko_KR.UTF-8" });
    expect(ko.stdout).toContain("=== 3. verify: Gemini API 코드");
    const en = demo({ LANG: "C" });
    expect(en.stdout).toContain("=== 3. verify: Gemini API code");
    expect(en.stdout).not.toContain("완료");
  }, 120_000);
});

const builtCli = (args: string[], cwd: string) =>
  spawnSync(process.execPath, [join(root, "dist", "cli.js"), "--lang", "en", ...args], { ...CHILD, cwd });

describe("verify resolves local imports (Q-2)", () => {
  const legacy = `import { GoogleGenerativeAI } from "@google/generative-ai";
import { PROMPT } from "./helper.js";

const genAI = new GoogleGenerativeAI("test-key");

export async function run(): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const r = await model.generateContent(PROMPT);
  return r.response.text();
}
`;
  const helper = 'export const PROMPT: string = "hello from the helper";\n';

  it("works for an in-place copy and for --out-dir output that did not copy the helper", async () => {
    const dir = scratch("local-imports");
    mkdirSync(join(dir, "old"));
    writeFileSync(join(dir, "old", "app.ts"), legacy);
    writeFileSync(join(dir, "old", "helper.ts"), helper);

    // migrate into an out dir: only app.ts is written there, helper.ts stays in old/
    const migrated = await runCli(["old", "--out-dir", "new"], {}, dir);
    expect(migrated.stdout).toContain("(written to new)");
    // the built CLI is used on purpose: under vitest the temp module is evaluated by vite, not by Node's loader
    const cli = builtCli(["verify", "old/app.ts", "new/app.ts", "--json"], dir);
    expect(cli.stderr).toBe("");
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout).requests.after[0].body.contents[0].parts[0].text).toBe("hello from the helper");

    // extensionless imports and a nested folder resolve as well
    mkdirSync(join(dir, "old", "lib"));
    writeFileSync(join(dir, "old", "lib", "text.ts"), 'export const WORD = "nested";\n');
    writeFileSync(join(dir, "old", "helper.ts"), 'import { WORD } from "./lib/text";\nexport const PROMPT = `hi ${WORD}`;\n');
    const again = builtCli(["verify", "old/app.ts", "new/app.ts", "--json"], dir);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("hi nested");
  });
});

describe("unknown option keeps the requested language (Q-6)", () => {
  it("--lang en wins over LANG=ko even when parseArgs fails", async () => {
    const res = await runCli(["--bogus", "--lang", "en"], { LANG: "ko_KR.UTF-8" });
    expect(res.code).toBe(2);
    expect(res.stderr).toBe("Unknown option --bogus. Run genai-codemod --help.\n");
  });

  it("Korean when asked with --lang=ko", async () => {
    const res = await runCli(["--lang=ko", "--bogus"], { LANG: "en_US.UTF-8" });
    expect(res.stderr).toBe("알 수 없는 옵션 --bogus. genai-codemod --help 를 확인하세요.\n");
  });
});

describe("text-throws-on-block leaves a trace in the code (Q-7)", () => {
  const before = fixture("blocked-try-catch", "before.ts");

  it("writes a marker comment and keeps reporting it on rerun", () => {
    const first = transformSource(before, read(before), { apiVersion: "keep" });
    expect(first.todos.map((t) => t.code)).toEqual(["text-throws-on-block"]);
    expect(first.output).toContain("// genai-codemod TODO(text-throws-on-block)");
    expect(first.output).toContain("    return r.text;");
    // the marker sits on its own line directly above the statement, with its indentation
    expect(first.output).toMatch(/\n {4}\/\/ genai-codemod TODO\(text-throws-on-block\)[^\n]*\n {4}return r\.text;/);

    const rerun = transformSource(before, first.output, { apiVersion: "keep" });
    expect(rerun.changed).toBe(false);
    expect(rerun.todos.map((t) => t.code)).toEqual(["text-throws-on-block"]);

    // removing the comment (the user dealt with it) ends the report
    const cleaned = first.output.replace(/ *\/\/ genai-codemod TODO[^\n]*\n/, "");
    expect(transformSource(before, cleaned, { apiVersion: "keep" }).todos).toEqual([]);
  });

  it("the marker survives a verify run (valid code)", async () => {
    const dir = scratch("marker");
    const out = join(dir, "after.ts");
    writeFileSync(out, transformSource(before, read(before), { apiVersion: "keep" }).output);
    const verified = await verifyFiles(before, out, { ...ok, response: "blocked" }, "en");
    expect(verified.match).toBe(false);
    expect(readFileSync(out, "utf8")).toContain("TODO(text-throws-on-block)");
  });
});

// ---------------------------------------------------------------------------------------------
// Round 3 (QA round 2): a client created in one module and imported by another (Q-1), and the
// verify message when a relative import of the old copy is missing (Q-3).

const CLIENT = `import { GoogleGenerativeAI } from "@google/generative-ai";

export const genAI = new GoogleGenerativeAI("test-key");
`;
const SERVICE = `import { genAI } from "./client.js";

export async function run(): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const r = await model.generateContent("hello");
  return r.response.text();
}
`;

/** Write `files` (relative path -> text) under a fresh scratch folder. */
function project(name: string, files: Record<string, string>): string {
  const dir = scratch(name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const codes = (stdout: string): string[] => [...stdout.matchAll(/^ {2}(\S+):(\d+) (\S+) - /gm)].map((m) => `${m[1]}:${m[2]} ${m[3]}`);

describe("shared client across modules (Q-1)", () => {
  it("scanning both files migrates the importer too, and verify matches", async () => {
    const dir = project("shared-client", { "src/client.ts": CLIENT, "src/service.ts": SERVICE });
    const res = await runCli(["src", "--out-dir", "migrated"], {}, dir);
    expect(res.code).toBe(0);
    expect(codes(res.stdout)).toContain("src/client.ts:3 client-shared");
    const service = read(join(dir, "migrated", "service.ts"));
    expect(service).toContain('const r = await genAI.models.generateContent({ model: "gemini-2.5-flash", contents: "hello" });');
    expect(service).toContain("return r.text;");
    expect(service).not.toContain("getGenerativeModel");
    expect(read(join(dir, "migrated", "client.ts"))).toContain("new GoogleGenAI(");

    const cli = builtCli(["verify", "src/service.ts", "migrated/service.ts"], dir);
    expect(cli.stderr).toBe("");
    expect(cli.stdout).toContain("Result: MATCH");
    expect(cli.status).toBe(0);
  });

  it("scanning only the client reports client-exported (exit 1)", async () => {
    const dir = project("shared-client-alone", { "src/client.ts": CLIENT, "src/service.ts": SERVICE });
    const res = await runCli(["src/client.ts"], {}, dir);
    expect(res.code).toBe(1);
    expect(codes(res.stdout)).toEqual(["src/client.ts:3 client-exported", "src/client.ts:3 api-version-pinned"]);
    const ko = await runCli(["src/client.ts", "--lang", "ko"], {}, dir);
    // particle-neutral wording ("이름으로"), whatever the exported name ends with (F-2)
    expect(ko.stdout).toContain('이 클라이언트는 "genAI" 이름으로 export 되고');
  });

  it("scanning only the importer (or after the client was written) reports cross-module (exit 1)", async () => {
    const dir = project("shared-client-importer", { "src/client.ts": CLIENT, "src/service.ts": SERVICE });
    const res = await runCli(["src/service.ts", "--report", "r.json"], {}, dir);
    expect(res.code).toBe(1);
    expect(codes(res.stdout)).toEqual(["src/service.ts:4 cross-module"]);
    const report = JSON.parse(read(join(dir, "r.json")));
    expect(report.files[0].todos[0]).toMatchObject({ code: "cross-module", line: 4 });

    // client.ts already migrated, service.ts not: the rerun must not be silent
    await runCli(["src/client.ts", "--write"], {}, dir);
    const half = await runCli(["src"], {}, dir);
    expect(half.code).toBe(1);
    expect(codes(half.stdout)).toEqual(["src/service.ts:4 cross-module"]);
  });

  it("--write on the folder is idempotent and leaves runnable code", async () => {
    const dir = project("shared-client-write", { "src/client.ts": CLIENT, "src/service.ts": SERVICE });
    expect((await runCli(["src", "--write"], {}, dir)).code).toBe(0);
    const rerun = await runCli(["src"], {}, dir);
    expect(rerun.code).toBe(0);
    expect(rerun.stdout).toContain("0 files changed");
    expect(rerun.stdout).toContain("0 TODOs");
  });

  it("aliases, default exports, extensionless paths and CommonJS are followed", async () => {
    const dir = project("shared-client-forms", {
      "lib/a.ts": 'import { GoogleGenerativeAI } from "@google/generative-ai";\nconst genAI = new GoogleGenerativeAI("k");\nexport { genAI as client };\n',
      "lib/b.ts": 'import { GoogleGenerativeAI } from "@google/generative-ai";\nexport default new GoogleGenerativeAI("k");\n',
      "lib/c.cjs": 'const { GoogleGenerativeAI } = require("@google/generative-ai");\nconst genAI = new GoogleGenerativeAI("k");\nmodule.exports = { genAI };\n',
      "use-a.ts": 'import { client as ai } from "./lib/a";\nexport const go = () => ai.getGenerativeModel({ model: "m" }).generateContent("x");\nexport async function run() {\n  const model = ai.getGenerativeModel({ model: "m" });\n  return (await model.generateContent("x")).response.text();\n}\n',
      "use-b.ts": 'import gen from "./lib/b.js";\nexport async function run() {\n  const model = gen.getGenerativeModel({ model: "m" });\n  return (await model.countTokens("x")).totalTokens;\n}\n',
      "use-c.cjs": 'const { genAI } = require("./lib/c.cjs");\nasync function run() {\n  const model = genAI.getGenerativeModel({ model: "m" });\n  return (await model.generateContent("x")).response.text();\n}\nmodule.exports = { run };\n',
    });
    const res = await runCli([".", "--out-dir", "out"], {}, dir);
    // use-a.ts line 2 chains getGenerativeModel(...) without a variable: reported, not guessed
    expect(codes(res.stdout).filter((c) => !c.includes("api-version"))).toEqual([
      "use-a.ts:2 handle-escapes", // TODOs are listed before warnings
      "lib/a.ts:3 client-shared",
      "lib/b.ts:2 client-shared",
      "lib/c.cjs:3 client-shared",
    ]);
    expect(read(join(dir, "out", "use-a.ts"))).toContain('return (await ai.models.generateContent({ model: "m", contents: "x" })).text;');
    expect(read(join(dir, "out", "use-b.ts"))).toContain('return (await gen.models.countTokens({ model: "m", contents: "x" })).totalTokens;');
    expect(read(join(dir, "out", "use-c.cjs"))).toContain('return (await genAI.models.generateContent({ model: "m", contents: "x" })).text;');
  });

  it("an exported model handle is reported where it is defined and where it is imported", async () => {
    const dir = project("shared-handle", {
      "src/model.ts":
        'import { GoogleGenerativeAI } from "@google/generative-ai";\nconst genAI = new GoogleGenerativeAI("k");\nexport const model = genAI.getGenerativeModel({ model: "m" });\n',
      "src/use.ts": 'import { model } from "./model.js";\nexport const run = async () => (await model.generateContent("x")).response.text();\n',
    });
    const res = await runCli(["src"], {}, dir);
    expect(res.code).toBe(1);
    expect(codes(res.stdout)).toEqual(
      expect.arrayContaining(["src/model.ts:3 handle-escapes", "src/use.ts:1 cross-module"]),
    );
  });

  it("an imported client whose constructor was not rewritten stays untouched in the importer", async () => {
    const dir = project("shared-client-dynamic", {
      "src/client.ts": 'import { GoogleGenerativeAI } from "@google/generative-ai";\nconst args = ["k"] as const;\nexport const genAI = new GoogleGenerativeAI(...args);\n',
      "src/service.ts": SERVICE,
    });
    const res = await runCli(["src"], {}, dir);
    expect(res.code).toBe(1);
    expect(codes(res.stdout)).toEqual(["src/client.ts:3 dynamic-model-params", "src/service.ts:4 cross-module"]);
    expect(res.stdout).not.toContain("+++ b/src/service.ts"); // the importer is not touched
  });
});

describe("verify explains a missing relative import (Q-3)", () => {
  it("names the user's file and the specifier, with the fix, in en and ko", async () => {
    const dir = project("missing-local", { "src/client.ts": CLIENT, "src/service.ts": SERVICE, "old/service.ts": SERVICE });
    const en = builtCli(["verify", "old/service.ts", "src/service.ts"], dir);
    expect(en.status).toBe(2);
    expect(en.stderr).toContain("old/service.ts imports ./client.js, which was not found next to it (old/client.js).");
    expect(en.stderr).toContain("git archive HEAD src | tar -x -C old");
    expect(en.stderr).not.toContain(".genai-codemod-");
    const ko = spawnSync(process.execPath, [join(root, "dist", "cli.js"), "--lang", "ko", "verify", "old/service.ts", "src/service.ts"], {
      ...CHILD,
      cwd: dir,
    });
    expect(ko.stderr).toContain("old/service.ts 이(가) import 하는 ./client.js 를 그 옆에서 찾지 못했습니다");
  });

  it("restoring the old tree (the suggested fix) makes verify match", async () => {
    // same layout as `mkdir old && git archive HEAD src | tar -x -C old` after --write
    const dir = project("restored-tree", { "old/src/client.ts": CLIENT, "old/src/service.ts": SERVICE, "src/client.ts": CLIENT, "src/service.ts": SERVICE });
    expect((await runCli(["src", "--write"], {}, dir)).code).toBe(0);
    const cli = builtCli(["verify", "old/src/service.ts", "src/service.ts"], dir);
    expect(cli.stderr).toBe("");
    expect(cli.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Round 6 (CI hardening): results must not depend on the machine (locale, file system order), and
// the CLI must not hang when the user's entry function leaves something running.

describe("same results on every machine", () => {
  it("files are scanned in code point order, whatever the locale", () => {
    // localeCompare would give _util, alpha, beta, beta-2, Zeta under en_US and another order elsewhere
    const names = ["beta.ts", "Zeta.ts", "alpha.ts", "_util.ts", "beta-2.ts"];
    const dir = project("scan-order", Object.fromEntries(names.map((n) => [join("src", n), "export {};\n"])));
    const shown = collectFiles(["src"], dir).map((f) => f.display);
    expect(shown).toEqual(["Zeta.ts", "_util.ts", "alpha.ts", "beta-2.ts", "beta.ts"].map((n) => join("src", n)));
    expect([...names].sort(byName)).toEqual(["Zeta.ts", "_util.ts", "alpha.ts", "beta-2.ts", "beta.ts"]);
  });

  it("verify exits when the entry function leaves a timer running", () => {
    // user code may keep the event loop alive (timers, keep-alive sockets); the CLI must still end
    const file = 'export async function run() {\n  setInterval(() => undefined, 1000);\n  return "done";\n}\n';
    const dir = project("lingering-timer", { "old.ts": file, "new.ts": file });
    const started = Date.now();
    const cli = builtCli(["verify", "old.ts", "new.ts"], dir);
    expect(cli.error).toBeUndefined(); // no ETIMEDOUT from the CHILD timeout
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain("Result: MATCH");
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});

// ---------------------------------------------------------------------------------------------
// Round 7 (QA Q-2): an entry function that never settles must not make verify wait forever, and
// stopping verify (Ctrl+C) must not leave the temp module next to the user's source.

describe("verify never waits forever", () => {
  const HANG = "export async function run() {\n  await new Promise(() => {\n    setInterval(() => undefined, 1000);\n  });\n}\n";
  const leftovers = (dir: string) => readdirSync(dir).filter((f) => f.startsWith(VERIFY_TEMP_PREFIX));

  it("--timeout stops a never-settling entry with a message, exit 2 and no temp module left", () => {
    const dir = project("hang-timeout", { "old.ts": HANG, "new.ts": HANG });
    const started = Date.now();
    const en = builtCli(["verify", "old.ts", "new.ts", "--timeout", "1"], dir);
    expect(en.error).toBeUndefined(); // ended by itself, not by the CHILD limit
    expect(en.status).toBe(2);
    expect(en.stderr).toContain('old.ts: "run" did not finish within 1 s');
    expect(en.stderr).toContain("--timeout <seconds>");
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(leftovers(dir)).toEqual([]);

    const ko = spawnSync(process.execPath, [join(root, "dist", "cli.js"), "--lang", "ko", "verify", "old.ts", "new.ts", "--timeout", "0.5"], {
      ...CHILD,
      cwd: dir,
    });
    expect(ko.status).toBe(2);
    expect(ko.stderr).toContain('old.ts: "run" 함수가 0.5초 안에 끝나지 않아');
  });

  it("rejects a --timeout that is not a positive number, or too large for a timer", async () => {
    // 9999999 s is above setTimeout's limit (2^31-1 ms): Node would fire after 1 ms (QA Q-1)
    for (const value of ["0", "-3", "soon", "9999999"]) {
      const res = await runCli(["verify", "a.ts", "b.ts", `--timeout=${value}`]);
      expect(res.code).toBe(2);
      expect(res.stderr).toContain(`Invalid --timeout value "${value}"`);
      expect(res.stderr).toContain(`at most ${MAX_TIMEOUT_SECONDS}`);
    }
    const ko = await runCli(["verify", "a.ts", "b.ts", "--timeout=9999999", "--lang", "ko"]);
    expect(ko.stderr).toContain('--timeout 값이 올바르지 않습니다: "9999999"');
    // "--timeout -3" looks like an option to parseArgs: a usage error, with one period, not ".."
    const ambiguous = await runCli(["verify", "a.ts", "b.ts", "--timeout", "-3"]);
    expect(ambiguous.code).toBe(2);
    // (Node's own wording may change between versions, so only the frame is checked)
    expect(ambiguous.stderr).toMatch(/^Usage error: .*--timeout.*[^.]\. Run genai-codemod --help\.\n$/);
  });

  it("the in-process API rejects with err.entryTimeout", async () => {
    const dir = project("hang-api", { "old.ts": HANG });
    const file = join(dir, "old.ts");
    await expect(verifyFiles(file, file, { ...ok, timeoutSeconds: 0.3 }, "en")).rejects.toMatchObject({ key: "err.entryTimeout" });
    expect(leftovers(dir)).toEqual([]);
  });

  it("the in-process API caps a huge limit instead of firing at once", async () => {
    // before the cap, setTimeout(1e12 ms) overflowed to 1 ms and a normal entry "timed out" at once
    const done = 'export async function run() {\n  await new Promise((r) => setTimeout(r, 50));\n  return "done";\n}\n';
    const dir = project("huge-timeout", { "old.ts": done });
    const file = join(dir, "old.ts");
    const verified = await verifyFiles(file, file, { ...ok, timeoutSeconds: 1e9 }, "en");
    expect(verified.match).toBe(true);
  });

  // Ctrl+C sends SIGINT, `kill` and CI runners send SIGTERM; both must clean up (QA Q-2)
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("%s during verify removes the temp module and exits %i", async (signal, exitCode) => {
    const dir = project(`hang-${signal.toLowerCase()}`, { "old.ts": HANG, "new.ts": HANG });
    const child = spawn(process.execPath, [join(root, "dist", "cli.js"), "--lang", "en", "verify", "old.ts", "new.ts"], {
      cwd: dir,
      stdio: "ignore",
    });
    const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
    try {
      // wait until verify is inside the entry function (its temp module exists)
      const deadline = Date.now() + 30_000;
      while (leftovers(dir).length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(leftovers(dir)).toHaveLength(1);
      child.kill(signal);
      expect(await exited).toBe(exitCode);
      expect(leftovers(dir)).toEqual([]);
    } finally {
      child.kill("SIGKILL"); // no-op when it already ended
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Round 8 (CI on a Linux runner): guards for things that work in a macOS checkout but break on Linux.

describe("the checkout also works on a Linux CI runner", () => {
  type LockEntry = { os?: string[]; cpu?: string[]; libc?: string[]; resolved?: string; integrity?: string; optionalDependencies?: Record<string, string> };

  // tsc (TypeScript 7) and vitest's bundler (rolldown) are native binaries picked per platform. A lockfile
  // written on one OS without the other platforms' optional packages makes `npm ci` skip them there
  // (npm/cli#4828), and the Linux job fails with "Unable to resolve @typescript/typescript-linux-x64".
  it.each(["typescript", "rolldown"])("package-lock.json has the %s native package for Linux x64 and macOS arm64", (name) => {
    const lock = JSON.parse(read(join(root, "package-lock.json"))) as { packages: Record<string, LockEntry> };
    const optional = Object.keys(lock.packages[`node_modules/${name}`]?.optionalDependencies ?? {});
    const natives = optional.map((dep) => lock.packages[`node_modules/${dep}`]);
    const has = (os: string, cpu: string): boolean =>
      natives.some((n) => !!n?.os?.includes(os) && !!n.cpu?.includes(cpu) && (!n.libc || n.libc.includes("glibc")) && !!n.resolved && !!n.integrity);
    expect({ linuxX64: has("linux", "x64"), darwinArm64: has("darwin", "arm64") }).toEqual({ linuxX64: true, darwinArm64: true });
  });

  it("relative imports spell file names with the exact case (Linux file systems are case-sensitive)", () => {
    // macOS finds main.ts for "./Main.js", a Linux runner does not; list each folder to compare exactly
    const spelledExactly = (path: string): boolean => {
      let dir = root;
      for (const part of relative(root, path).split(sep)) {
        if (!readdirSync(dir).includes(part)) return false;
        dir = join(dir, part);
      }
      return true;
    };
    const sources = [
      ...readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts")).map((f) => join(root, "src", f)),
      ...readdirSync(join(root, "test")).filter((f) => f.endsWith(".ts")).map((f) => join(root, "test", f)),
      join(root, "scripts", "demo.mjs"),
    ];
    const wrong: string[] = [];
    for (const file of sources) {
      for (const match of read(file).matchAll(/(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = resolve(dirname(file), match[1] ?? "");
        // "./x.js" means x.ts in TypeScript sources; example code inside test strings points nowhere and is skipped
        const found = [target, target.replace(/\.js$/, ".ts")].filter((candidate) => existsSync(candidate));
        if (found.length > 0 && !found.some(spelledExactly)) wrong.push(`${relative(root, file)}: ${match[1]}`);
      }
    }
    expect(sources.length).toBeGreaterThan(20);
    expect(wrong).toEqual([]);
  });
});
