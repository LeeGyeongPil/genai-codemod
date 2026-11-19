#!/usr/bin/env node
// Entry point. Checks the Node.js version before loading anything that needs a newer runtime.
import { resolveLang, t } from "./i18n.js";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  const lang = resolveLang(undefined, process.env);
  process.stderr.write(t(lang, "err.nodeVersion", { found: process.versions.node }) + "\n");
  process.exit(2);
}

const { main } = await import("./main.js");
process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
  isTTY: process.stdout.isTTY === true,
});
