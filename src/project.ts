import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build"]);

export class PathError extends Error {
  constructor(readonly path: string) {
    super(`Path not found: ${path}`);
    this.name = "PathError";
  }
}

export interface SourceEntry {
  /** Absolute path. */
  abs: string;
  /** Path shown to the user (relative to the working directory when possible). */
  display: string;
  /** Path relative to the argument it came from; used by --out-dir. */
  relative: string;
}

function isSource(name: string): boolean {
  return EXTENSIONS.test(name) && !/\.d\.(ts|mts|cts)$/.test(name);
}

function walk(dir: string, root: string, out: SourceEntry[], cwd: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(join(dir, entry.name), root, out, cwd);
    } else if (entry.isFile() && isSource(entry.name)) {
      const abs = join(dir, entry.name);
      out.push({ abs, display: relative(cwd, abs) || abs, relative: relative(root, abs) });
    }
  }
}

const JS_TO_TS: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/**
 * Which scanned file a relative import points to ("./client.js" -> client.ts, "./client",
 * "./lib" -> lib/index.ts). Only files in `known` count; returns undefined otherwise.
 */
export function resolveLocalImport(fromDir: string, specifier: string, known: Set<string>): string | undefined {
  const target = resolve(fromDir, specifier);
  const ext = /\.[cm]?[jt]sx?$/.exec(target)?.[0] ?? "";
  const stem = ext ? target.slice(0, -ext.length) : target;
  const candidates = [
    target,
    ...(JS_TO_TS[ext] ?? []).map((e) => stem + e),
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((e) => target + e),
    ...["index.ts", "index.tsx", "index.js"].map((name) => join(target, name)),
  ];
  return candidates.find((c) => known.has(c));
}

/** Expand file and folder arguments into source files (deduplicated, sorted by argument order). */
export function collectFiles(paths: string[], cwd: string): SourceEntry[] {
  const out: SourceEntry[] = [];
  for (const p of paths.length > 0 ? paths : ["."]) {
    const abs = resolve(cwd, p);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      throw new PathError(p);
    }
    if (stat.isDirectory()) walk(abs, abs, out, cwd);
    else out.push({ abs, display: relative(cwd, abs) || abs, relative: relative(dirname(abs), abs) });
  }
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.abs) ? false : (seen.add(f.abs), true)));
}
