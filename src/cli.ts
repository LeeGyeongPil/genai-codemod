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
const code = await main(process.argv.slice(2), {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
  isTTY: process.stdout.isTTY === true,
});

// verify 는 사용자의 entry 함수를 실행한다. 그 코드가 타이머·소켓을 남기면 Node 는 끝나지 않으므로
// (CI 에서는 잡이 멈춘 채 시간 제한까지 간다) 출력이 다 나간 뒤 종료 코드를 들고 직접 끝낸다.
const flushed = (stream: NodeJS.WriteStream) => new Promise<void>((done) => stream.write("", () => done()));
await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
process.exit(code);
