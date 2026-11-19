import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/main.js";
import { VERIFY_TEMP_PREFIX } from "../src/project.js";
import { transformSource, type TransformOptions } from "../src/transform/index.js";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const fixture = (...parts: string[]): string => join(root, "test", "fixtures", ...parts);
const tmpRoot = join(root, "test", ".tmp");

export const read = (path: string): string => readFileSync(path, "utf8");

/**
 * Options for every spawnSync in the tests. spawnSync blocks the worker's event loop, so vitest's own
 * testTimeout cannot fire while a child hangs; without this a hanging child would stall CI until the
 * job limit instead of failing with a message.
 */
export const CHILD = { encoding: "utf8", timeout: 45_000, killSignal: "SIGKILL" } as const;

/** Fresh scratch folder inside the repo (so fixtures resolve the SDKs from node_modules). */
export function scratch(name: string): string {
  const dir = join(tmpRoot, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Copy a shared folder (examples/, fixtures) into a scratch folder.
 * Test files run in parallel and verify writes a short-lived .genai-codemod-*.mjs next to the
 * file it checks, so a plain copy could pick up (or trip over) another test's temp module.
 */
export function copyTree(from: string, to: string): void {
  cpSync(from, to, { recursive: true, filter: (src) => !basename(src).startsWith(VERIFY_TEMP_PREFIX) });
}

/** Transform a fixture file and write the result next to other scratch files; returns the output path. */
export function transformToScratch(source: string, scratchName: string, opts: TransformOptions = { apiVersion: "keep" }) {
  const result = transformSource(source, read(source), opts);
  const out = join(scratch(scratchName), "after.ts");
  writeFileSync(out, result.output);
  return { result, out };
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCli(args: string[], env: Record<string, string> = {}, cwd = root): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    stdout: (s) => void (stdout += s),
    stderr: (s) => void (stderr += s),
    cwd,
    env: { LANG: "en_US.UTF-8", ...env },
    isTTY: false,
  });
  return { code, stdout, stderr };
}
