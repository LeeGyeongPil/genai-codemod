import { t, type Lang, type MessageKey } from "./i18n.js";
import type { ApiVersionMode, Finding } from "./transform/types.js";

export interface ReportItem {
  line: number;
  column: number;
  /** Stable English id, identical in every language. */
  code: string;
  /** Message in the selected language. */
  message: string;
}

export interface FileReport {
  path: string;
  changed: boolean;
  todos: ReportItem[];
  warnings: ReportItem[];
}

export interface Report {
  tool: string;
  version: string;
  apiVersionMode: ApiVersionMode;
  summary: { filesScanned: number; filesChanged: number; todos: number; warnings: number };
  files: FileReport[];
}

export function describe(lang: Lang, kind: "todo" | "warn", f: Finding): ReportItem {
  return {
    line: f.line,
    column: f.column,
    code: f.code,
    message: t(lang, `${kind}.${f.code}` as MessageKey, f.vars),
  };
}

export function buildReport(
  version: string,
  mode: ApiVersionMode,
  filesScanned: number,
  files: FileReport[],
): Report {
  return {
    tool: "genai-codemod",
    version,
    apiVersionMode: mode,
    summary: {
      filesScanned,
      filesChanged: files.filter((f) => f.changed).length,
      todos: files.reduce((n, f) => n + f.todos.length, 0),
      warnings: files.reduce((n, f) => n + f.warnings.length, 0),
    },
    files,
  };
}

export type WriteMode = { kind: "dry" } | { kind: "write" } | { kind: "out"; dir: string };

/** Human-readable summary, TODO list and warning list. */
export function renderSummary(lang: Lang, report: Report, mode: WriteMode): string {
  const modeText =
    mode.kind === "dry" ? t(lang, "mode.dry") : mode.kind === "write" ? t(lang, "mode.write") : t(lang, "mode.out", { dir: mode.dir });
  const lines = [
    t(lang, "sum.line", {
      scanned: report.summary.filesScanned,
      changed: report.summary.filesChanged,
      mode: modeText,
      todos: report.summary.todos,
      warnings: report.summary.warnings,
    }),
  ];
  const todos = report.files.flatMap((f) => f.todos.map((i) => `  ${f.path}:${i.line} ${i.code} - ${i.message}`));
  if (todos.length > 0) lines.push("", t(lang, "sum.todoTitle"), ...todos);
  const warnings = report.files.flatMap((f) => f.warnings.map((i) => `  ${f.path}:${i.line} ${i.code} - ${i.message}`));
  if (warnings.length > 0) lines.push("", t(lang, "sum.warnTitle"), ...warnings);
  if (mode.kind === "dry" && report.summary.filesChanged > 0) lines.push("", t(lang, "sum.hintWrite"));
  if (mode.kind !== "dry" && report.summary.filesChanged > 0) lines.push("", t(lang, "sum.hintVerify"));
  return lines.join("\n");
}
