#!/usr/bin/env node
// Entry point. Checks the Node.js version before loading anything that needs a newer runtime.
import { resolveLang, t } from "./i18n.js";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  const lang = resolveLang(undefined, process.env);
  process.stderr.write(t(lang, "err.nodeVersion", { found: process.versions.node }) + "\n");
  process.exit(2);
}

const { main, removeTempModules } = await import("./main.js");

// Ctrl+C (or a kill) while verify runs the user's entry function: delete the temporary module that
// sits next to the user's source before leaving, then exit with the usual shell codes (130 / 143).
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => {
    removeTempModules();
    process.exit(code);
  });
}

const code = await main(process.argv.slice(2), {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
  isTTY: process.stdout.isTTY === true,
});

// verify runs the user's entry function. If that code leaves a timer or socket open, Node would not
// exit (on CI the job would hang until its time limit), so end the process ourselves once all output
// has been flushed.
const flushed = (stream: NodeJS.WriteStream) => new Promise<void>((done) => stream.write("", () => done()));
await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
process.exit(code);
