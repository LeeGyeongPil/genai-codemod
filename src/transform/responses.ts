import { Node } from "ts-morph";
import type { CallExpression, ForOfStatement } from "ts-morph";
import { TEXT_THROWS_MARKER } from "./checks.js";
import type { Ctx } from "./types.js";

/** What a rewritten call returns, which decides how its result may be used. */
export type ResultKind = "generate" | "stream" | "embed" | "count";

const GETTERS = new Set(["text", "functionCalls"]);

/** Find how the result of a rewritten call is used and rewrite the response accessors. */
export function trackCallResult(ctx: Ctx, call: CallExpression, kind: ResultKind): void {
  let node: Node = call;
  const parent = call.getParent();
  if (Node.isAwaitExpression(parent)) node = parent;
  const holder = node.getParent();

  if (Node.isVariableDeclaration(holder) && holder.getInitializer() === node) {
    const nameNode = holder.getNameNode();
    if (!Node.isIdentifier(nameNode)) {
      ctx.todo(holder, "handle-escapes", { detail: "destructured result" });
      return;
    }
    for (const ref of nameNode.findReferencesAsNodes()) {
      if (ref.getSourceFile() === ctx.sf) analyzeUse(ctx, ref, kind);
    }
  } else if (Node.isParenthesizedExpression(holder)) {
    analyzeUse(ctx, holder, kind); // (await model.generateContent(x)).response.text()
  }
}

/** `expr` is a use of the result value (a variable reference or a parenthesized call). */
function analyzeUse(ctx: Ctx, expr: Node, kind: ResultKind): void {
  const access = expr.getParent();
  if (!Node.isPropertyAccessExpression(access) || access.getExpression() !== expr) return;
  const name = access.getName();

  if (kind === "embed" && name === "embedding") {
    ctx.edits.replace(access, () => `${ctx.edits.render(expr)}.embeddings[0]`);
    return;
  }

  if (kind === "stream") {
    if (name === "response") {
      ctx.todo(access, "stream-aggregate");
    } else if (name === "stream") {
      ctx.edits.replace(access, () => ctx.edits.render(expr));
      const loop = access.getParent();
      if (Node.isForOfStatement(loop) && loop.getExpression() === access) rewriteChunkLoop(ctx, loop);
    }
    return;
  }

  if (kind === "generate" && name === "response") rewriteResponse(ctx, expr, access);
}

/** `r.response...` for a one-shot result. */
function rewriteResponse(ctx: Ctx, expr: Node, response: Node): void {
  const member = response.getParent();
  if (!Node.isPropertyAccessExpression(member) || member.getExpression() !== response) {
    ctx.todo(response, "handle-escapes", { detail: "r.response used as a value" });
    return;
  }
  const call = member.getParent();
  if (Node.isCallExpression(call) && call.getExpression() === member) {
    const getter = member.getName();
    if (GETTERS.has(getter) && call.getArguments().length === 0) {
      ctx.edits.replace(call, () => `${ctx.edits.render(expr)}.${getter}`);
      if (getter === "text" && insideTryWithCatch(call)) {
        ctx.todo(call, "text-throws-on-block");
        leaveMarker(ctx, call);
      }
    } else {
      ctx.todo(call, "unsupported-usage", { detail: `response.${getter}()` });
    }
    return;
  }
  // property such as r.response.candidates or r.response.usageMetadata -> r.candidates
  ctx.edits.replace(response, () => ctx.edits.render(expr));
}

/** for await (const c of r.stream) { c.text() } -> c.text */
function rewriteChunkLoop(ctx: Ctx, loop: ForOfStatement): void {
  const init = loop.getInitializer();
  if (!Node.isVariableDeclarationList(init)) return;
  const decl = init.getDeclarations()[0];
  const nameNode = decl?.getNameNode();
  if (!nameNode || !Node.isIdentifier(nameNode)) return;
  for (const ref of nameNode.findReferencesAsNodes()) {
    if (ref.getSourceFile() !== ctx.sf) continue;
    const member = ref.getParent();
    if (!Node.isPropertyAccessExpression(member) || member.getExpression() !== ref) continue;
    const call = member.getParent();
    const getter = member.getName();
    if (Node.isCallExpression(call) && call.getExpression() === member && GETTERS.has(getter) && call.getArguments().length === 0) {
      ctx.edits.replace(call, () => `${ctx.edits.render(ref)}.${getter}`);
    }
  }
}

/** One-line comment above the statement, so a rerun after --write still reports the TODO. */
function leaveMarker(ctx: Ctx, call: Node): void {
  const statement = call.getFirstAncestor((n) => Node.isStatement(n) && !Node.isBlock(n));
  if (!statement) return;
  const start = statement.getStart();
  const column = ctx.sf.getLineAndColumnAtPos(start).column - 1;
  ctx.edits.replaceRange(start, start, `${TEXT_THROWS_MARKER}\n${ctx.text.slice(start - column, start).replace(/\S/g, " ")}`);
}

function insideTryWithCatch(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  let child: Node = node;
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    ) {
      return false;
    }
    if (Node.isTryStatement(current) && current.getTryBlock() === child && current.getCatchClause()) return true;
    child = current;
    current = current.getParent();
  }
  return false;
}
