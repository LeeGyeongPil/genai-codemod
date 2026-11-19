// Node module customization hooks (registered by run.ts with module.registerHooks, or with
// module.register on Node versions that do not have registerHooks yet).
// They let verify import the TypeScript files a service file depends on:
//   - "./helper.js" or "./helper" is mapped to helper.ts / .tsx / .mts next to the importer
//   - .ts files are transpiled the same way as the entry file
//   - when the importer lives in an --out-dir copy, files that were not migrated are taken
//     from the original folder
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toModuleSource } from "./transpile.js";

export interface HookData {
  /** Folder of the migrated copy. */
  from?: string;
  /** Folder of the original files, used when a sibling is missing in `from`. */
  to?: string;
}

type Resolved = { url: string; format?: string | null | undefined; shortCircuit?: boolean };
type NextResolve = (specifier: string, context?: { parentURL?: string }) => Resolved | Promise<Resolved>;
type Loaded = { format: string | null | undefined; source?: string | Buffer | undefined; shortCircuit?: boolean };
type NextLoad = (url: string, context?: { format?: string | null | undefined }) => Loaded | Promise<Loaded>;

let data: HookData = {};

/** Used by module.register: the data object is handed over once, when the hooks thread starts. */
export function initialize(init: HookData | undefined): void {
  data = init ?? {};
}

const TS_EXT = /\.(ts|tsx|mts)$/;
const JS_TO_TS: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"] };

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

/** First existing file for a path an importer wrote, trying the TypeScript spellings. */
function locate(target: string): string | undefined {
  if (isFile(target)) return target;
  const dot = target.lastIndexOf(".");
  const ext = dot > target.lastIndexOf(sep) ? target.slice(dot) : "";
  const stem = ext ? target.slice(0, dot) : target;
  const candidates = [
    ...(JS_TO_TS[ext] ?? []).map((e) => stem + e),
    ...[".ts", ".tsx", ".mts", ".js", ".mjs"].map((e) => target + e),
    ...["index.ts", "index.tsx", "index.js"].map((name) => join(target, name)),
  ];
  return candidates.find(isFile);
}

export function makeResolve(hookData: HookData) {
  return (specifier: string, context: { parentURL?: string }, next: NextResolve) => resolveWith(hookData, specifier, context, next);
}

function resolveWith(hookData: HookData, specifier: string, context: { parentURL?: string }, next: NextResolve): Resolved | Promise<Resolved> {
  const relativeSpec = specifier.startsWith("./") || specifier.startsWith("../");
  if (!relativeSpec || !context.parentURL?.startsWith("file:")) return next(specifier, context);

  const parentDir = dirname(fileURLToPath(context.parentURL));
  const bases = [parentDir];
  if (hookData.from && hookData.to) {
    const rel = relative(hookData.from, parentDir);
    if (!rel.startsWith("..")) bases.push(resolvePath(hookData.to, rel));
  }
  for (const base of bases) {
    const found = locate(resolvePath(base, specifier));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export function loadHook(url: string, context: { format?: string | null | undefined }, next: NextLoad): Loaded | Promise<Loaded> {
  if (url.startsWith("file:") && TS_EXT.test(url)) {
    const file = fileURLToPath(url);
    return { format: "module", source: toModuleSource(file, readFileSync(file, "utf8")), shortCircuit: true };
  }
  return next(url, context);
}

/** Entry points for module.register (hooks thread). */
export function resolve(specifier: string, context: { parentURL?: string }, next: NextResolve): Resolved | Promise<Resolved> {
  return resolveWith(data, specifier, context, next);
}
export { loadHook as load };
