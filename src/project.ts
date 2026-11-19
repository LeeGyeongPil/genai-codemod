import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build"]);
/** verify 가 원본 옆에 잠깐 만드는 임시 모듈 이름 앞부분. 스캔 대상에서 늘 뺀다. */
export const VERIFY_TEMP_PREFIX = ".genai-codemod-";

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

/**
 * 이름을 코드 포인트 순서로 비교한다. localeCompare 는 실행 환경의 로캘(LANG, ICU)에 따라 순서가
 * 달라져 같은 폴더라도 macOS·Linux·CI 에서 diff·보고서 순서가 달라질 수 있다.
 */
export function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function walk(dir: string, root: string, out: SourceEntry[], cwd: string): void {
  // readdir 순서는 파일 시스템마다 다르다(ext4 는 해시 순) — 항상 정렬해서 결과를 고정한다
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name))) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(join(dir, entry.name), root, out, cwd);
    } else if (entry.isFile() && isSource(entry.name) && !entry.name.startsWith(VERIFY_TEMP_PREFIX)) {
      // 같은 폴더에서 verify 가 도는 중이면 임시 .mjs 가 보일 수 있다 — 사용자 코드가 아니므로 건너뛴다
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
