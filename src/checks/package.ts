import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Finding } from "../transform/types.js";

/** Nearest package.json at or above the file's folder. */
export function findPackageJson(fromFile: string): string | undefined {
  let dir = dirname(fromFile);
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Lowest Node major a semver range allows, from the first number in it (">=18", "^20.1.0", "18 || 20"). */
function lowestMajor(range: string): number | undefined {
  const match = /(\d+)/.exec(range);
  return match ? Number(match[1]) : undefined;
}

function lineOf(text: string, needle: string): number {
  const index = text.indexOf(needle);
  return index < 0 ? 1 : text.slice(0, index).split("\n").length;
}

/** Warnings about the project that owns migrated files: Node engine and duplicate SDK packages. */
export function checkPackageJson(path: string): Finding[] {
  let text: string;
  let json: { engines?: { node?: string }; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  try {
    text = readFileSync(path, "utf8");
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  const range = json.engines?.node;
  const major = range ? lowestMajor(range) : undefined;
  if (range && major !== undefined && major < 22) {
    findings.push({ code: "node-engine", line: lineOf(text, `"node"`), column: 1, vars: { range } });
  }
  // devDependencies are ignored on purpose: verify needs both SDKs installed during the migration.
  const deps = { ...json.peerDependencies, ...json.dependencies };
  if (deps["@google-cloud/vertexai"] && deps["@google/genai"]) {
    findings.push({ code: "duplicate-genai", line: lineOf(text, `"@google-cloud/vertexai"`), column: 1, vars: {} });
  }
  return findings;
}
