import { Node, SyntaxKind } from "ts-morph";
import type { ClientKind, Ctx } from "./types.js";

export const NEW_PACKAGE = "@google/genai";
const LEGACY_PACKAGES: Record<string, ClientKind> = {
  "@google/generative-ai": "gemini",
  "@google-cloud/vertexai": "vertex",
};
const SERVER_PACKAGE_PREFIX = "@google/generative-ai/";

/** Legacy export name -> new export name. HarmCategory and HarmBlockThreshold keep their names. */
const RENAMES: Record<string, string> = {
  GoogleGenerativeAI: "GoogleGenAI",
  VertexAI: "GoogleGenAI",
  SchemaType: "Type",
};
const CLIENT_EXPORTS: Record<string, ClientKind> = { GoogleGenerativeAI: "gemini", VertexAI: "vertex" };

export interface ImportResult {
  /** True when the file imports any legacy Google SDK module. */
  legacy: boolean;
  /** Local (original) identifier of a legacy client class -> kind. */
  clientLocals: Map<string, ClientKind>;
}

/** An identifier that refers to a binding (not a property name, member name or import/export specifier). */
function isReference(id: Node): boolean {
  const p = id.getParent();
  if (!p) return false;
  if (Node.isPropertyAccessExpression(p)) return p.getNameNode() !== id;
  if (Node.isQualifiedName(p)) return p.getRight() !== id;
  if (Node.isBindingElement(p)) return false;
  if (
    Node.isPropertyAssignment(p) ||
    Node.isPropertySignature(p) ||
    Node.isPropertyDeclaration(p) ||
    Node.isMethodDeclaration(p) ||
    Node.isMethodSignature(p) ||
    Node.isEnumMember(p)
  ) {
    return p.getNameNode() !== id;
  }
  if (Node.isShorthandPropertyAssignment(p) || Node.isImportSpecifier(p) || Node.isExportSpecifier(p)) return false;
  return true;
}

function renameReferences(ctx: Ctx, from: string, to: string): void {
  for (const id of ctx.sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getText() !== from || !isReference(id)) continue;
    if (id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
    ctx.edits.replace(id, to);
  }
}

function quoted(literalText: string, value: string): string {
  const q = literalText.startsWith("'") ? "'" : '"';
  return q + value + q;
}

export function rewriteImports(ctx: Ctx): ImportResult {
  const { sf } = ctx;
  const result: ImportResult = { legacy: false, clientLocals: new Map() };
  const declared = new Set<string>(); // local names already imported from the new package

  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== NEW_PACKAGE) continue;
    for (const n of decl.getNamedImports()) declared.add(n.getAliasNode()?.getText() ?? n.getName());
  }

  for (const decl of sf.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (spec.startsWith(SERVER_PACKAGE_PREFIX)) {
      result.legacy = true;
      ctx.todo(decl, "server-managers");
      continue;
    }
    const kind = LEGACY_PACKAGES[spec];
    if (!kind) continue;
    result.legacy = true;
    if (decl.getNamespaceImport() || decl.getDefaultImport()) {
      ctx.todo(decl, "unsupported-import-form");
      continue;
    }

    const kept: string[] = [];
    let dropped = false;
    for (const s of decl.getNamedImports()) {
      const name = s.getName();
      const alias = s.getAliasNode()?.getText();
      const newName = RENAMES[name] ?? name;
      const clientKind = CLIENT_EXPORTS[name];
      if (clientKind) result.clientLocals.set(alias ?? name, clientKind);
      if (!alias && newName !== name) renameReferences(ctx, name, newName);
      const local = alias ?? newName;
      if (declared.has(local)) {
        dropped = true; // e.g. GoogleGenerativeAI and VertexAI both become GoogleGenAI
        continue;
      }
      declared.add(local);
      const typePrefix = s.isTypeOnly() ? "type " : "";
      const text = alias ? `${typePrefix}${newName} as ${alias}` : `${typePrefix}${newName}`;
      kept.push(text);
      if (newName !== name) ctx.edits.replace(s, text);
    }

    if (kept.length === 0 && decl.getNamedImports().length > 0) {
      removeStatement(ctx, decl);
      continue;
    }
    if (dropped) {
      const named = decl.getNamedImports()[0]?.getParent();
      if (named) ctx.edits.replace(named, `{ ${kept.join(", ")} }`);
    }
    const lit = decl.getModuleSpecifier();
    ctx.edits.replace(lit, quoted(lit.getText(), NEW_PACKAGE));
  }

  rewriteRequires(ctx, result);
  return result;
}

/** CommonJS: const { GoogleGenerativeAI } = require("@google/generative-ai") */
function rewriteRequires(ctx: Ctx, result: ImportResult): void {
  for (const call of ctx.sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "require") continue;
    const [arg] = call.getArguments();
    if (!arg || !Node.isStringLiteral(arg)) continue;
    const spec = arg.getLiteralValue();
    if (spec.startsWith(SERVER_PACKAGE_PREFIX)) {
      result.legacy = true;
      ctx.todo(call, "server-managers");
      continue;
    }
    const kind = LEGACY_PACKAGES[spec];
    if (!kind) continue;
    result.legacy = true;
    const decl = call.getParent();
    const pattern = Node.isVariableDeclaration(decl) ? decl.getNameNode() : undefined;
    if (!pattern || !Node.isObjectBindingPattern(pattern)) {
      ctx.todo(call, "unsupported-import-form");
      continue;
    }
    for (const el of pattern.getElements()) {
      const propNode = el.getPropertyNameNode();
      const exported = propNode ? propNode.getText() : el.getName();
      const local = el.getName();
      const newName = RENAMES[exported] ?? exported;
      const clientKind = CLIENT_EXPORTS[exported];
      if (clientKind) result.clientLocals.set(local, clientKind);
      if (newName === exported) continue;
      if (propNode) {
        ctx.edits.replace(propNode, newName);
      } else {
        ctx.edits.replace(el, newName);
        renameReferences(ctx, exported, newName);
      }
    }
    ctx.edits.replace(arg, quoted(arg.getText(), NEW_PACKAGE));
  }
}

/** Remove a whole statement including its line break when it sits alone on its lines. */
export function removeStatement(ctx: Ctx, node: Node): void {
  const text = ctx.text;
  let start = node.getStart();
  let end = node.getEnd();
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const prefixBlank = /^[ \t]*$/.test(text.slice(lineStart, start));
  const rest = /^[ \t]*(\r?\n|$)/.exec(text.slice(end));
  if (prefixBlank && rest) {
    start = lineStart;
    end += rest[0].length;
  }
  ctx.edits.replaceRange(start, end, "");
}
