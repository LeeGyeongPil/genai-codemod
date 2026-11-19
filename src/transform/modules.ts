// Cross-module support: a client created in one file and imported by another.
//
// The CLI transforms files one by one. To follow a shared client it runs twice:
//   pass 1: every file reports which old-SDK clients and model handles it exports
//   pass 2: files that import one of those get them via `opts.lookupImport` and are
//           migrated as if the client had been created locally.
// Anything that cannot be followed (handles, clients whose constructor was not rewritten,
// files outside the scanned paths) is reported as a TODO instead of being guessed.
import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { ClientInfo, Ctx, ExportedLegacy } from "./types.js";

/** One binding that comes from a local (relative) module. */
export interface LocalImport {
  /** Local name in this file ("" for re-exports, which only count as a use of the module). */
  local: string;
  /** Exported name in the other module: a name, "default" or "*" (namespace / re-export). */
  imported: string;
  /** Module specifier as written, e.g. "./client.js". */
  specifier: string;
  node: Node;
}

const isRelative = (spec: string): boolean => spec.startsWith("./") || spec.startsWith("../");

/** ES imports, `export ... from` and CommonJS requires of relative modules. */
export function collectLocalImports(sf: SourceFile): LocalImport[] {
  const out: LocalImport[] = [];
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (!isRelative(specifier)) continue;
    const def = decl.getDefaultImport();
    if (def) out.push({ local: def.getText(), imported: "default", specifier, node: def });
    const ns = decl.getNamespaceImport();
    if (ns) out.push({ local: ns.getText(), imported: "*", specifier, node: ns });
    for (const s of decl.getNamedImports()) {
      out.push({ local: s.getAliasNode()?.getText() ?? s.getName(), imported: s.getName(), specifier, node: s });
    }
  }
  for (const decl of sf.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier && isRelative(specifier)) out.push({ local: "", imported: "*", specifier, node: decl });
  }
  // const { genAI } = require("./client") / const genAI = require("./client")
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "require") continue;
    const [arg] = call.getArguments();
    if (!arg || !Node.isStringLiteral(arg) || !isRelative(arg.getLiteralValue())) continue;
    const specifier = arg.getLiteralValue();
    const holder = call.getParent();
    const name = Node.isVariableDeclaration(holder) ? holder.getNameNode() : undefined;
    if (name && Node.isObjectBindingPattern(name)) {
      for (const el of name.getElements()) {
        out.push({ local: el.getName(), imported: el.getPropertyNameNode()?.getText() ?? el.getName(), specifier, node: el });
      }
    } else if (name && Node.isIdentifier(name)) {
      out.push({ local: name.getText(), imported: "default", specifier, node: name });
    } else {
      out.push({ local: "", imported: "*", specifier, node: call });
    }
  }
  return out;
}

/** Names under which a local variable leaves this module (ES exports and CommonJS exports). */
function exportedNames(sf: SourceFile, local: string): Array<{ name: string; node: Node }> {
  const out: Array<{ name: string; node: Node }> = [];
  for (const statement of sf.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const d of statement.getDeclarations()) {
      if (d.getName() === local) out.push({ name: statement.hasDefaultKeyword() ? "default" : local, node: d });
    }
  }
  for (const decl of sf.getExportDeclarations()) {
    if (decl.getModuleSpecifier()) continue; // re-export from another module
    for (const s of decl.getNamedExports()) {
      if (s.getName() === local) out.push({ name: s.getAliasNode()?.getText() ?? local, node: s });
    }
  }
  for (const assignment of sf.getExportAssignments()) {
    if (assignment.getExpression().getText() === local) out.push({ name: "default", node: assignment });
  }
  // module.exports = genAI / module.exports = { genAI } / exports.genAI = genAI / module.exports.genAI = genAI
  for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = bin.getLeft().getText();
    const right = bin.getRight();
    if (left === "module.exports") {
      if (right.getText() === local) out.push({ name: "default", node: bin });
      if (Node.isObjectLiteralExpression(right)) {
        for (const p of right.getProperties()) {
          const value = Node.isPropertyAssignment(p) ? p.getInitializer()?.getText() : Node.isShorthandPropertyAssignment(p) ? p.getName() : undefined;
          if (value === local && (Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p))) out.push({ name: p.getName(), node: p });
        }
      }
    }
    const named = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(left);
    if (named && right.getText() === local) out.push({ name: named[1] ?? local, node: bin });
  }
  return out;
}

const position = (node: Node): { line: number; column: number } => node.getSourceFile().getLineAndColumnAtPos(node.getStart());

/** Clients and model handles this file exports (computed on the original source). */
export function findExports(ctx: Ctx, clients: Map<string, ClientInfo>): ExportedLegacy[] {
  const out: ExportedLegacy[] = [];
  for (const [key, client] of clients) {
    if (client.importedFrom) continue; // re-exporting an imported client is not followed
    const names = key === DIRECT_DEFAULT_EXPORT && client.node ? [{ name: "default", node: client.node }] : exportedNames(ctx.sf, key);
    for (const { name, node } of names) {
      out.push({ name, kind: "client", clientKind: client.kind, migrated: client.migrated, ...position(node) });
    }
  }
  // const model = genAI.getGenerativeModel(...) that is exported: reported where it is defined
  // (handle-escapes) and where it is imported (cross-module).
  for (const decl of ctx.sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "getGenerativeModel") continue;
    if (!clients.has(callee.getExpression().getText())) continue;
    for (const { name, node } of exportedNames(ctx.sf, decl.getName())) {
      out.push({ name, kind: "handle", ...position(node) });
    }
  }
  return out;
}

/** Key used in the client map for `export default new GoogleGenerativeAI(...)` (never a valid identifier). */
export const DIRECT_DEFAULT_EXPORT = "<default>";

/**
 * Pass 2: clients imported from another scanned file whose constructor was rewritten are tracked
 * like local ones. Imported model handles and clients that stayed on the old SDK become TODOs.
 */
export function importedClients(ctx: Ctx, imports: LocalImport[]): Map<string, ClientInfo> {
  const clients = new Map<string, ClientInfo>();
  const lookup = ctx.opts.lookupImport;
  if (!lookup) return clients;
  for (const imp of imports) {
    const entry = lookup(imp.specifier, imp.imported);
    if (!entry || !imp.local) continue;
    if (entry.kind === "client" && entry.migrated) {
      clients.set(imp.local, { kind: entry.clientKind, name: imp.local, migrated: true, importedFrom: imp.specifier });
    } else if (entry.kind === "handle") {
      ctx.todo(imp.node, "cross-module", { name: imp.local, module: imp.specifier, detail: "model handle" });
    }
  }
  return clients;
}
