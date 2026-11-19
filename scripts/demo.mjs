// npm start: migrate the sample app, then prove the migrated code sends the same requests.
// No API key and no network are needed: verify runs the real SDKs under a fetch mock.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The demo talks in the same language as the CLI: GENAI_CODEMOD_LANG > LC_ALL > LC_MESSAGES > LANG.
import { resolveLang, t } from "../dist/i18n.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = ["dist/cli.js"];
// No --lang is passed on purpose: the CLI resolves the language from the same environment.
const lang = resolveLang(undefined, process.env);

// Each step finishes in a few seconds; a step that hangs is stopped instead of blocking forever (CI).
const STEP_TIMEOUT_S = 120;

function step(title, args, { expectExit = [0] } = {}) {
  console.log(`\n=== ${title}`);
  console.log(`$ genai-codemod ${args.join(" ")}\n`);
  const result = spawnSync(process.execPath, [...cli, ...args], {
    cwd: root,
    stdio: "inherit",
    timeout: STEP_TIMEOUT_S * 1000,
    killSignal: "SIGKILL",
  });
  if (result.error?.code === "ETIMEDOUT") {
    console.error("\n" + t(lang, "demo.timeout", { seconds: STEP_TIMEOUT_S }));
    process.exit(1);
  }
  if (!expectExit.includes(result.status)) {
    console.error("\n" + t(lang, "demo.unexpectedExit", { code: result.status, expected: expectExit.join(" / ") }));
    process.exit(1);
  }
}

rmSync(`${root}/.demo-out`, { recursive: true, force: true });

// 1) Dry run on one file: shows the diff, writes nothing
step(t(lang, "demo.step1"), ["examples/legacy-app/gemini.ts"]);

// 2) Rewrite the whole sample app into .demo-out/ (TODOs make the exit code 1 on purpose)
step(t(lang, "demo.step2"), ["examples/legacy-app", "--out-dir", ".demo-out"], { expectExit: [1] });

// 3) The migrated Gemini code must send the same requests as the original
step(t(lang, "demo.step3"), ["verify", "examples/legacy-app/gemini.ts", ".demo-out/gemini.ts"]);

// 4) Same for Vertex AI (a fake auth client is injected)
step(t(lang, "demo.step4"), ["verify", "examples/legacy-app/vertex.ts", ".demo-out/vertex.ts", "--vertex"]);

if (!process.argv.includes("--hidden")) {
  console.log("\n" + t(lang, "demo.done"));
  console.log(t(lang, "demo.next"));
  process.exit(0);
}

// 5) A hidden difference: without the apiVersion pin the endpoint changes from v1beta to v1
step(t(lang, "demo.step5"), [
  "examples/legacy-app/gemini.ts",
  "--api-version",
  "sdk-default",
  "--out-dir",
  ".demo-out/sdk-default",
], { expectExit: [0, 1] });
step(t(lang, "demo.step5b"), ["verify", "examples/legacy-app/gemini.ts", ".demo-out/sdk-default/gemini.ts"], {
  expectExit: [1],
});

// 6) A hidden difference: a blocked answer no longer throws, it returns undefined
step(t(lang, "demo.step6"), ["verify", "examples/legacy-app/blocked.ts", ".demo-out/blocked.ts", "--response", "blocked"], {
  expectExit: [1],
});

console.log("\n" + t(lang, "demo.done"));
