import { Project, ScriptKind } from "ts-morph";
import type { Node } from "ts-morph";
import type { Vars } from "../i18n.js";
import { checkNestedGenerationConfig, checkTextThrowsMarkers, checkVertexFunctionSchema } from "./checks.js";
import { checkVertexPreview, rewriteClients } from "./clients.js";
import { EditSet } from "./edits.js";
import { rewriteHandles } from "./handles.js";
import { NEW_PACKAGE, rewriteImports } from "./imports.js";
import { collectLocalImports, findExports, importedClients } from "./modules.js";
import type { Ctx, ExportedLegacy, Finding, TransformOptions, TransformResult } from "./types.js";

export type { ApiVersionMode, ExportedLegacy, Finding, TransformOptions, TransformResult } from "./types.js";

export class ParseError extends Error {
  constructor(
    readonly fileName: string,
    readonly detail: string,
  ) {
    super(`Could not parse ${fileName}: ${detail}`);
    this.name = "ParseError";
  }
}

// One in-memory project is reused for every file; no disk access, no node_modules lookup.
const project = new Project({
  useInMemoryFileSystem: true,
  skipLoadingLibFiles: true,
  compilerOptions: { allowJs: true, jsx: 1, target: 99 },
});

function scriptKindOf(fileName: string): ScriptKind {
  if (/\.tsx$/.test(fileName)) return ScriptKind.TSX;
  if (/\.jsx$/.test(fileName)) return ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(fileName)) return ScriptKind.JS;
  return ScriptKind.TS;
}

const unchanged = (text: string): TransformResult => ({ output: text, changed: false, legacy: false, todos: [], warnings: [], exports: [] });

/** Worth parsing: mentions a Google SDK, an old-SDK method, or (in the cross-module pass) a local import. */
function mayNeedWork(text: string, opts: TransformOptions): boolean {
  if (/generative-ai|vertexai|@google\/genai|getGenerativeModel/.test(text)) return true;
  return opts.lookupImport !== undefined && /(?:from|require\()\s*["']\.\.?\//.test(text);
}

function finding(node: Node, code: string, vars: Vars): Finding {
  const { line, column } = node.getSourceFile().getLineAndColumnAtPos(node.getStart());
  return { code, line, column, vars };
}

/** Rewrite one source file from the legacy Google SDKs to @google/genai. */
export function transformSource(fileName: string, text: string, opts: TransformOptions): TransformResult {
  // Cheap pre-check: files that never mention a Google SDK are left alone without parsing.
  if (!mayNeedWork(text, opts)) return unchanged(text);

  const sf = project.createSourceFile(`/input${Math.random().toString(36).slice(2)}/${fileName.replace(/^.*[\\/]/, "")}`, text, {
    overwrite: true,
    scriptKind: scriptKindOf(fileName),
  });
  try {
    const parseDiagnostics = (sf.compilerNode as unknown as { parseDiagnostics?: Array<{ messageText: unknown; start?: number }> }).parseDiagnostics ?? [];
    if (parseDiagnostics.length > 0) {
      const first = parseDiagnostics[0];
      const message = typeof first?.messageText === "string" ? first.messageText : "syntax error";
      const line = sf.getLineAndColumnAtPos(first?.start ?? 0).line;
      throw new ParseError(fileName, `${message} (line ${line})`);
    }

    const todos: Finding[] = [];
    const warnings: Finding[] = [];
    const seen = new Set<string>();
    const add = (list: Finding[], node: Node, code: string, vars: Vars): void => {
      const f = finding(node, code, vars);
      const key = `${f.code}:${f.line}:${f.column}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(f);
    };
    const localImports = collectLocalImports(sf);
    const ctx: Ctx = {
      sf,
      text,
      edits: new EditSet(text),
      opts,
      importedFrom: new Map(localImports.filter((i) => i.local !== "").map((i) => [i.local, i.specifier])),
      todo: (node, code, vars = {}) => add(todos, node, code, vars),
      warn: (node, code, vars = {}) => add(warnings, node, code, vars),
    };

    const imports = rewriteImports(ctx);
    // Clients created in another scanned file (cross-module pass) are followed like local ones.
    const shared = importedClients(ctx, localImports);
    checkVertexPreview(ctx, shared);
    let exports: ExportedLegacy[] = [];
    if (imports.legacy) {
      const clients = rewriteClients(ctx, imports.clientLocals);
      exports = findExports(ctx, clients);
      rewriteHandles(ctx, new Map([...shared, ...clients]));
      checkVertexFunctionSchema(ctx);
    } else if (shared.size > 0 || text.includes(NEW_PACKAGE) || text.includes("getGenerativeModel")) {
      // shared clients, or leftover getGenerativeModel calls (half-migrated files, clients from other files)
      rewriteHandles(ctx, shared);
    }
    if (text.includes(NEW_PACKAGE)) checkNestedGenerationConfig(ctx);
    checkTextThrowsMarkers(ctx);

    const output = ctx.edits.apply();
    const byPosition = (a: Finding, b: Finding): number => a.line - b.line || a.column - b.column;
    return {
      output,
      changed: output !== text,
      legacy: imports.legacy,
      todos: todos.sort(byPosition),
      warnings: warnings.sort(byPosition),
      exports,
    };
  } finally {
    project.removeSourceFile(sf);
  }
}
