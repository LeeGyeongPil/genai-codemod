import { dirname } from "node:path";
import { t, type Lang } from "../i18n.js";
import { compareOutcomes, NORMALIZATION_RULES, toPlain, type Difference } from "./compare.js";
import { runWithMock, type RunOptions } from "./run.js";

export interface VerifyResult {
  match: boolean;
  differences: Difference[];
  text: string;
  json: string;
}

/** Run both files under the mock, compare, and render the result in the chosen language. */
export async function verifyFiles(before: string, after: string, options: RunOptions, lang: Lang): Promise<VerifyResult> {
  // Sequential on purpose: both runs replace globalThis.fetch.
  const b = await runWithMock(before, options);
  const a = await runWithMock(after, options, dirname(before));
  const differences = compareOutcomes(b, a);
  const match = differences.length === 0;

  const lines = [
    t(lang, "v.title", { before, after }),
    t(lang, "v.mode", { response: options.response, vertex: options.vertex ? t(lang, "v.vertexSuffix") : "" }),
    t(lang, "v.requests", { before: b.requests.length, after: a.requests.length }),
    t(lang, "v.rules"),
    ...NORMALIZATION_RULES.map((rule) => `  - ${t(lang, rule.message)}`),
  ];
  if (!match) {
    lines.push(t(lang, "v.diffs"));
    for (const d of differences) lines.push(`  ${d.path}: ${d.before} != ${d.after}`);
  }
  lines.push(match ? t(lang, "v.resultMatch") : t(lang, "v.resultMismatch", { count: differences.length }));
  lines.push(t(lang, "v.mockNote"));

  const json = JSON.stringify(
    {
      result: match ? "MATCH" : "MISMATCH",
      response: options.response,
      vertex: options.vertex,
      normalization: NORMALIZATION_RULES.map((r) => r.id),
      requests: { before: b.requests, after: a.requests },
      returned: { before: toPlain(b.value) ?? null, after: toPlain(a.value) ?? null },
      differences,
    },
    null,
    2,
  );
  return { match, differences, text: lines.join("\n"), json };
}
