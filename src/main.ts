import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkPackageJson, findPackageJson } from "./checks/package.js";
import { unifiedDiff } from "./diff.js";
import { isLangFlag, resolveLang, t, type Lang, type MessageKey, type Vars } from "./i18n.js";
import { collectFiles, PathError, resolveLocalImport, type SourceEntry } from "./project.js";
import { buildReport, describe, renderSummary, type FileReport, type WriteMode } from "./report.js";
import {
  ParseError,
  transformSource,
  type ApiVersionMode,
  type ExportedLegacy,
  type Finding,
  type TransformResult,
} from "./transform/index.js";
import { VerifyError } from "./verify/errors.js";
import { verifyFiles } from "./verify/index.js";
import { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS } from "./verify/run.js";

// cli.ts deletes leftover temp modules when the user presses Ctrl+C during verify.
export { removeTempModules } from "./verify/run.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  isTTY: boolean;
}

const OPTIONS = {
  write: { type: "boolean" },
  "out-dir": { type: "string" },
  report: { type: "string" },
  "api-version": { type: "string" },
  lang: { type: "string" },
  "no-color": { type: "boolean" },
  entry: { type: "string" },
  response: { type: "string" },
  timeout: { type: "string" },
  vertex: { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** Relative path when the target is inside the working directory, absolute otherwise. */
function shown(cwd: string, target: string): string {
  const rel = relative(cwd, target);
  return rel === "" || rel.startsWith("..") ? target : rel;
}

function parse(args: string[]) {
  return parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
}

function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("../package.json") as { version: string }).version;
}

/** Find --lang before parseArgs runs, so even usage errors come out in the requested language. */
function prescanLang(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") return undefined;
    if (arg.startsWith("--lang=")) return arg.slice("--lang=".length);
    if (arg === "--lang") return args[i + 1];
  }
  return undefined;
}

/** Run the CLI; returns the process exit code. Output goes through `io` so tests can capture it. */
export async function main(argv: string[], io: Io): Promise<number> {
  let lang: Lang = resolveLang(prescanLang(argv), io.env);
  const fail = (key: MessageKey, vars: Vars = {}): number => {
    io.stderr(t(lang, key, vars) + "\n");
    return 2;
  };

  let parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    // Node's parseArgs messages end with "."; the template adds its own, so drop it (no "..")
    const first = ((error as Error).message.split("\n")[0] ?? "invalid arguments").replace(/\.+$/, "");
    const unknown = first.match(/Unknown option '([^']+)'/);
    if ((error as NodeJS.ErrnoException).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && unknown) {
      return fail("err.unknownOption", { option: unknown[1] ?? "" });
    }
    return fail("err.usage", { detail: first });
  }
  const { values, positionals } = parsed;

  if (values.lang !== undefined) {
    if (!isLangFlag(values.lang)) return fail("err.badLang", { value: values.lang });
    lang = values.lang;
  }
  if (values.help) {
    io.stdout(t(lang, "help") + "\n");
    return 0;
  }
  if (values.version) {
    io.stdout(packageVersion() + "\n");
    return 0;
  }

  if (positionals[0] === "verify") return runVerify(positionals.slice(1), values, io, lang, fail);
  return runTransform(positionals, values, io, lang, fail);
}

type Values = ReturnType<typeof parse>["values"];
type Fail = (key: MessageKey, vars?: Vars) => number;

async function runVerify(files: string[], values: Values, io: Io, lang: Lang, fail: Fail): Promise<number> {
  const [before, after] = files;
  if (!before || !after || files.length !== 2) return fail("err.verifyArgs");
  const response = values.response ?? "ok";
  if (response !== "ok" && response !== "blocked") return fail("err.badResponse", { value: response });
  // seconds each entry function may run before verify stops it (it never waits forever)
  const timeout = values.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(values.timeout);
  // above MAX_TIMEOUT_SECONDS a Node timer would fire at once, so such values are refused too
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_SECONDS) {
    return fail("err.badTimeout", { value: values.timeout ?? "", max: MAX_TIMEOUT_SECONDS });
  }
  try {
    const result = await verifyFiles(
      resolve(io.cwd, before),
      resolve(io.cwd, after),
      { entry: values.entry ?? "run", response, vertex: values.vertex === true, timeoutSeconds: timeout },
      lang,
    );
    // Show the paths the user typed, not the absolute ones.
    const text = result.text.replace(resolve(io.cwd, before), before).replace(resolve(io.cwd, after), after);
    io.stdout((values.json ? result.json : text) + "\n");
    return result.match ? 0 : 1;
  } catch (error) {
    if (error instanceof VerifyError) {
      // Show the paths the user typed (or paths relative to the working directory), not absolute ones.
      const vars: Vars = {};
      for (const [key, value] of Object.entries(error.vars)) {
        vars[key] =
          typeof value !== "string"
            ? value
            : value === resolve(io.cwd, before)
              ? before
              : value === resolve(io.cwd, after)
                ? after
                : key === "path" || key === "file"
                  ? shown(io.cwd, value)
                  : value;
      }
      return fail(error.key, vars);
    }
    throw error;
  }
}

function runTransform(paths: string[], values: Values, io: Io, lang: Lang, fail: Fail): number {
  const apiVersion = values["api-version"] ?? "keep";
  if (apiVersion !== "keep" && apiVersion !== "sdk-default") return fail("err.badApiVersion", { value: apiVersion });
  if (values.write && values["out-dir"] !== undefined) return fail("err.writeAndOut");
  const mode: ApiVersionMode = apiVersion;
  const color = io.isTTY && !io.env["NO_COLOR"] && !values["no-color"];
  const writeMode: WriteMode = values.write
    ? { kind: "write" }
    : values["out-dir"] !== undefined
      ? { kind: "out", dir: values["out-dir"] }
      : { kind: "dry" };

  let sources;
  try {
    sources = collectFiles(paths, io.cwd);
  } catch (error) {
    if (error instanceof PathError) return fail("err.pathMissing", { path: error.path });
    throw error;
  }

  const files: FileReport[] = [];
  const packages = new Set<string>();
  const diffs: string[] = [];
  const written: string[] = [];
  let parseFailures = 0;

  // Pass 1: transform every file on its own and note which old-SDK clients/handles it exports.
  const results = new Map<string, { source: SourceEntry; text: string; result: TransformResult }>();
  for (const source of sources) {
    let text: string;
    try {
      text = readFileSync(source.abs, "utf8");
    } catch (error) {
      parseFailures++;
      fail("err.fileRead", { path: source.display, detail: (error as Error).message });
      continue;
    }
    try {
      results.set(source.abs, { source, text, result: transformSource(source.display, text, { apiVersion: mode }) });
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      parseFailures++;
      fail("err.parse", { path: source.display, detail: error.detail });
    }
  }

  // Pass 2 (only when some file exports a client or handle): files that import one are transformed
  // again with a lookup, so `import { genAI } from "./client.js"` is migrated together with client.ts.
  const exporters = [...results.entries()].filter(([, r]) => r.result.exports.length > 0);
  const importers = new Map<string, Set<string>>(); // "<exporter abs>\0<export name>" -> importer files
  if (exporters.length > 0) {
    const known = new Set(results.keys());
    for (const [abs, entry] of results) {
      const lookupImport = (specifier: string, name: string): ExportedLegacy | undefined => {
        const target = resolveLocalImport(dirname(abs), specifier, known);
        if (!target || target === abs) return undefined;
        const key = `${target}\0${name}`;
        importers.set(key, (importers.get(key) ?? new Set()).add(abs));
        return results.get(target)?.result.exports.find((e) => e.name === name);
      };
      entry.result = transformSource(entry.source.display, entry.text, { apiVersion: mode, lookupImport });
    }
    // An exported client that no scanned file imports: its importers elsewhere would break silently.
    for (const [abs, entry] of exporters) {
      for (const exp of entry.result.exports) {
        if (exp.kind !== "client" || !exp.migrated) continue;
        const users = new Set([...(importers.get(`${abs}\0${exp.name}`) ?? []), ...(importers.get(`${abs}\0*`) ?? [])]);
        const at = { line: exp.line, column: exp.column };
        if (users.size === 0) entry.result.todos.push({ code: "client-exported", ...at, vars: { name: exp.name } });
        else entry.result.warnings.push({ code: "client-shared", ...at, vars: { name: exp.name, count: users.size } });
      }
      const byPosition = (a: Finding, b: Finding): number => a.line - b.line || a.column - b.column;
      entry.result.todos.sort(byPosition);
      entry.result.warnings.sort(byPosition);
    }
  }

  for (const { source, text, result } of results.values()) {
    if (result.changed) {
      if (writeMode.kind === "dry") {
        diffs.push(unifiedDiff(source.display, text, result.output, { color }));
      } else {
        const target = writeMode.kind === "write" ? source.abs : join(resolve(io.cwd, writeMode.dir), source.relative);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, result.output);
        written.push(t(lang, "sum.wrote", { path: shown(io.cwd, target) }));
      }
    }
    if (result.legacy) {
      const pkg = findPackageJson(source.abs);
      if (pkg) packages.add(pkg);
    }
    if (result.changed || result.todos.length > 0 || result.warnings.length > 0) {
      files.push({
        path: source.display,
        changed: result.changed,
        todos: result.todos.map((f) => describe(lang, "todo", f)),
        warnings: result.warnings.map((f) => describe(lang, "warn", f)),
      });
    }
  }

  for (const pkg of [...packages].sort()) {
    const findings = checkPackageJson(pkg);
    if (findings.length > 0) {
      files.push({ path: shown(io.cwd, pkg), changed: false, todos: [], warnings: findings.map((f) => describe(lang, "warn", f)) });
    }
  }

  const report = buildReport(packageVersion(), mode, sources.length, files);
  if (values.report) {
    const target = resolve(io.cwd, values.report);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + "\n");
  }

  const out: string[] = [];
  if (diffs.length > 0) out.push(diffs.join("\n\n"), "");
  if (written.length > 0) out.push(written.join("\n"), "");
  out.push(renderSummary(lang, report, writeMode));
  io.stdout(out.join("\n") + "\n");

  if (parseFailures > 0) return 2;
  return report.summary.todos > 0 ? 1 : 0;
}
