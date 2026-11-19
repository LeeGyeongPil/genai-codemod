import { isDeepStrictEqual } from "node:util";
import type { MessageKey } from "../i18n.js";

export interface CapturedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  apiKey: string | null;
  body: unknown;
}

export interface RunOutcome {
  requests: CapturedRequest[];
  value: unknown;
}

export interface Difference {
  path: string;
  before: string;
  after: string;
}

/** Normalization rules; the ids are shown to the user, so what is ignored is never hidden. */
export const NORMALIZATION_RULES: Array<{ id: string; message: MessageKey }> = [
  { id: "systemInstruction.role", message: "v.rule.role" },
  { id: "empty-defaults", message: "v.rule.emptyDefaults" },
  { id: "object-key-order", message: "v.rule.order" },
];

/**
 * Drop systemInstruction.role (old SDK "system", new SDK "user") and empty generationConfig {} / safetySettings []
 * (the old SDK always sent them). Key order is ignored by the comparison itself.
 */
export function normalizeBody(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const copy = structuredClone(body) as Record<string, unknown>;
    const si = copy["systemInstruction"];
    if (si && typeof si === "object" && !Array.isArray(si)) delete (si as Record<string, unknown>)["role"];
    for (const key of ["generationConfig", "safetySettings"]) {
      const v = copy[key];
      if (v && typeof v === "object" && Object.keys(v).length === 0) delete copy[key]; // {} or []
    }
    return copy;
  }
  return body;
}

/** Make arbitrary return values comparable: plain data only, undefined kept distinct from missing. */
export function toPlain(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return typeof value === "function" ? "[Function]" : value;
  if (depth > 20) return "[Deep]";
  if (Array.isArray(value)) return value.map((v) => toPlain(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = toPlain((value as Record<string, unknown>)[key], depth + 1);
  return out;
}

export function format(value: unknown): string {
  if (value === undefined) return "undefined";
  const text = JSON.stringify(value);
  return text.length > 120 ? text.slice(0, 117) + "..." : text;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function diffValues(before: unknown, after: unknown, path: string, out: Difference[]): void {
  // An object against a missing value is reported leaf by leaf (more useful than one big blob).
  if (isObject(before) && after === undefined && Object.keys(before).length > 0) after = {};
  if (isObject(after) && before === undefined && Object.keys(after).length > 0) before = {};
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) diffValues(before[key], after[key], `${path}.${key}`, out);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i++) diffValues(before[i], after[i], `${path}[${i}]`, out);
    return;
  }
  if (!isDeepStrictEqual(before, after)) out.push({ path, before: format(before), after: format(after) });
}

export function compareOutcomes(before: RunOutcome, after: RunOutcome): Difference[] {
  const out: Difference[] = [];
  if (before.requests.length !== after.requests.length) {
    out.push({ path: "request.count", before: String(before.requests.length), after: String(after.requests.length) });
  }
  const common = Math.min(before.requests.length, after.requests.length);
  for (let i = 0; i < common; i++) {
    const b = before.requests[i];
    const a = after.requests[i];
    if (!b || !a) continue;
    const prefix = `request[${i}]`;
    diffValues(b.method, a.method, `${prefix}.method`, out);
    diffValues(b.path, a.path, `${prefix}.path`, out);
    diffValues(b.query, a.query, `${prefix}.query`, out);
    diffValues(b.apiKey, a.apiKey, `${prefix}.apiKey`, out);
    diffValues(normalizeBody(b.body), normalizeBody(a.body), `${prefix}.body`, out);
  }
  diffValues(toPlain(before.value), toPlain(after.value), "return", out);
  return out;
}
