import { Node, SyntaxKind } from "ts-morph";
import type { Ctx } from "./types.js";

function propertyName(node: Node): string | undefined {
  if (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) {
    const name = node.getNameNode().getText();
    return name.replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/**
 * `config: { generationConfig: {...} }` is accepted by @google/genai but silently ignored,
 * a mistake people and coding agents make when porting by hand.
 */
export function checkNestedGenerationConfig(ctx: Ctx): void {
  for (const prop of ctx.sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (propertyName(prop) !== "config") continue;
    const value = prop.getInitializer();
    if (!value || !Node.isObjectLiteralExpression(value)) continue;
    const nested = value.getProperties().find((p) => propertyName(p) === "generationConfig");
    if (nested) ctx.warn(nested, "nested-generation-config");
  }
}

/** Vertex function declaration schemas need a manual move (M1 does not rewrite them). */
export function checkVertexFunctionSchema(ctx: Ctx): void {
  for (const prop of ctx.sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (propertyName(prop) === "function_declarations") ctx.todo(prop, "vertex-function-schema");
  }
  for (const id of ctx.sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getText() === "FunctionDeclarationSchemaType" && !id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) {
      ctx.todo(id, "vertex-function-schema");
    }
  }
}

export const TEXT_THROWS_MARKER =
  "// genai-codemod TODO(text-throws-on-block): .text is undefined when the answer is blocked; the catch below no longer fires.";

/** A marker left by an earlier --write run: keep reporting the TODO until the user removes the comment. */
export function checkTextThrowsMarkers(ctx: Ctx): void {
  const needle = "genai-codemod TODO(text-throws-on-block)";
  let index = ctx.text.indexOf(needle);
  while (index !== -1) {
    const node = ctx.sf.getDescendantAtPos(index) ?? ctx.sf;
    ctx.todo(node, "text-throws-on-block");
    index = ctx.text.indexOf(needle, index + needle.length);
  }
}
