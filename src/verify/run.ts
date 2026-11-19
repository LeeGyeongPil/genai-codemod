import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFakeAuthClient } from "./auth.js";
import type { CapturedRequest, RunOutcome } from "./compare.js";
import { VerifyError } from "./errors.js";
import { VERIFY_TEMP_PREFIX } from "../project.js";
import { cannedResponse, type MockResponseKind } from "./responses.js";
import { loadHook, makeResolve } from "./hooks.js";
import { toModuleSource } from "./transpile.js";

export interface RunOptions {
  entry: string;
  response: MockResponseKind;
  vertex: boolean;
  /** Seconds the module import plus the entry call may take (default DEFAULT_TIMEOUT_SECONDS). */
  timeoutSeconds?: number;
}

export const DEFAULT_TIMEOUT_SECONDS = 60;
/**
 * Largest limit setTimeout can hold (2^31-1 ms, about 24.8 days). Above it Node warns and fires after
 * 1 ms, so the CLI rejects bigger values and the library caps them.
 */
export const MAX_TIMEOUT_SECONDS = 2_147_483;

/** Temp modules that exist right now; removeTempModules() deletes them when the CLI is interrupted. */
const liveTempModules = new Set<string>();

export function removeTempModules(): void {
  for (const temp of liveTempModules) rmSync(temp, { force: true });
  liveTempModules.clear();
}

/**
 * Settle with `work`, or reject with err.entryTimeout after `seconds`. The timer is cleared as soon as
 * `work` settles; while it runs it keeps Node alive, so a never-settling entry still ends with a message.
 */
async function withTimeout<T>(work: Promise<T>, seconds: number, vars: { file: string; entry: string }): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    const ms = Math.min(seconds, MAX_TIMEOUT_SECONDS) * 1000;
    timer = setTimeout(() => reject(new VerifyError("err.entryTimeout", { ...vars, seconds })), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Where the hooks module lives: next to this file when built, in dist/ when run from sources (tests). */
function hooksUrl(): URL {
  const built = new URL("./hooks.js", import.meta.url);
  if (existsSync(fileURLToPath(built))) return built;
  return new URL("../../dist/verify/hooks.js", import.meta.url);
}

/**
 * Make "./helper.js"-style imports of TypeScript siblings work. registerHooks (Node 22.15+) runs in
 * this thread and can be removed again; older Node 22 falls back to the deprecated register().
 */
function registerLocalImports(data: { from: string; to: string | undefined }): () => void {
  const modern = (nodeModule as unknown as { registerHooks?: (hooks: object) => { deregister(): void } }).registerHooks;
  if (typeof modern === "function") {
    const handle = modern({ resolve: makeResolve(data), load: loadHook });
    return () => handle.deregister();
  }
  nodeModule.register(hooksUrl(), { parentURL: import.meta.url, data });
  return () => undefined;
}

async function record(input: unknown, init: RequestInit | undefined): Promise<CapturedRequest> {
  const request = input instanceof Request ? input : undefined;
  const url = new URL(request ? request.url : String(input instanceof URL ? input.href : input));
  const headers = new Headers(init?.headers ?? request?.headers);
  const query = Object.fromEntries(url.searchParams);
  const apiKey = headers.get("x-goog-api-key") ?? query["key"] ?? null;
  delete query["key"];
  let raw: unknown = init?.body ?? (request ? await request.clone().text() : undefined);
  if (raw instanceof Uint8Array) raw = new TextDecoder().decode(raw);
  let body: unknown = null;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  return { method: (init?.method ?? request?.method ?? "GET").toUpperCase(), path: url.pathname, query, apiKey, body };
}

/**
 * Node's "Cannot find module '/abs/old/lib/prompts.js' imported from /abs/old/.genai-codemod-1234-app.ts.mjs"
 * names the temp module; map it back to the user's file and the specifier they wrote ("./lib/prompts.js").
 */
export function localImportMissing(message: string, temp: string, file: string): { file: string; specifier: string; path: string } | undefined {
  const match = /Cannot find module '([^']+)' imported from (.+)/.exec(message.split("\n")[0] ?? "");
  const missing = match?.[1];
  const importerRaw = match?.[2]?.trim();
  if (!missing || !importerRaw) return undefined;
  const missingPath = missing.startsWith("file:") ? fileURLToPath(missing) : missing;
  if (!isAbsolute(missingPath)) return undefined; // a package name, not a local file
  const importer = importerRaw.startsWith("file:") ? fileURLToPath(importerRaw) : importerRaw;
  let specifier = relative(dirname(importer), missingPath).split(sep).join("/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  // Node reports real paths (/private/tmp on macOS), so the temp module is recognised by its unique name
  const fromTemp = importer === temp || basename(importer) === basename(temp);
  return { file: fromTemp ? file : importer, specifier, path: missingPath };
}

/** Run one file's entry function under a recording fetch mock; the real SDKs build the requests. */
/** `siblingsFrom`: folder of the original files, for local imports that --out-dir did not copy. */
export async function runWithMock(file: string, options: RunOptions, siblingsFrom?: string): Promise<RunOutcome> {
  const abs = resolve(file);
  let source: string;
  try {
    source = readFileSync(abs, "utf8");
  } catch (error) {
    throw new VerifyError("err.fileRead", { path: file, detail: (error as Error).message });
  }

  // The temp module sits next to the original so its imports resolve from the user's project.
  const temp = join(dirname(abs), `${VERIFY_TEMP_PREFIX}${randomBytes(4).toString("hex")}-${basename(abs)}.mjs`);
  // Local imports ("./helper.js") are resolved and transpiled by the hooks, TypeScript files included.
  const hookData = { from: dirname(abs), to: siblingsFrom };
  const unregister = registerLocalImports(hookData);
  const requests: CapturedRequest[] = [];
  const realFetch = globalThis.fetch;
  try {
    liveTempModules.add(temp);
    writeFileSync(temp, toModuleSource(abs, source));
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const captured = await record(input, init);
      requests.push(captured);
      return cannedResponse(options.response, captured.path);
    }) as typeof fetch;

    // Import and call the entry function. Both run the user's code, so both count toward the time limit.
    const importAndCall = async (): Promise<unknown> => {
      let mod: Record<string, unknown>;
      try {
        mod = (await import(pathToFileURL(temp).href)) as Record<string, unknown>;
      } catch (error) {
        const match = /Cannot find (?:package|module) '([^']+)'/.exec((error as Error).message);
        if (match && /^@google/.test(match[1] ?? "")) throw new VerifyError("err.sdkMissing", { pkg: match[1] ?? "", file });
        const local = localImportMissing((error as Error).message, temp, file);
        if (local) throw new VerifyError("err.localImportMissing", local);
        throw new VerifyError("err.verifyRun", { file, detail: (error as Error).message });
      }
      const entry = mod[options.entry];
      if (typeof entry !== "function") throw new VerifyError("err.entryMissing", { file, entry: options.entry });

      const authClient = options.vertex ? createFakeAuthClient(abs, source) : undefined;
      try {
        return await (entry as (arg: unknown) => unknown)(options.vertex ? { authClient } : undefined);
      } catch (error) {
        throw new VerifyError("err.verifyRun", { file, detail: (error as Error).message });
      }
    };
    const seconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    const value = await withTimeout(importAndCall(), seconds, { file, entry: options.entry });
    return { requests, value };
  } finally {
    globalThis.fetch = realFetch;
    unregister();
    rmSync(temp, { force: true });
    liveTempModules.delete(temp);
  }
}
