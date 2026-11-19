import { Node, SyntaxKind } from "ts-morph";
import { DIRECT_DEFAULT_EXPORT } from "./modules.js";
import type { ClientInfo, ClientKind, Ctx } from "./types.js";

/** Endpoint versions the legacy SDKs used; pinned in keep mode so requests stay identical. */
const PINNED_VERSION: Record<ClientKind, string> = { gemini: "v1beta", vertex: "v1" };
const VERTEX_OPTION_KEYS = new Set(["project", "location", "googleAuthOptions"]);

/**
 * Rewrites `new GoogleGenerativeAI(key)` / `new VertexAI({...})` to `new GoogleGenAI({...})`.
 * Returns the variables that hold a client so handle tracking can start from them.
 */
export function rewriteClients(ctx: Ctx, clientLocals: Map<string, ClientKind>): Map<string, ClientInfo> {
  const clients = new Map<string, ClientInfo>();
  const keep = ctx.opts.apiVersion === "keep";

  for (const ne of ctx.sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const callee = ne.getExpression();
    if (!Node.isIdentifier(callee)) continue;
    const kind = clientLocals.get(callee.getText());
    if (!kind) continue;

    const args = ne.getArguments();
    const first = args[0];
    const pin = keep ? `, apiVersion: "${PINNED_VERSION[kind]}"` : "";
    let replacement: (() => string) | undefined;

    if (kind === "gemini") {
      if (!first || Node.isSpreadElement(first) || Node.isObjectLiteralExpression(first)) {
        ctx.todo(ne, "dynamic-model-params", { detail: "client constructor argument" });
      } else {
        replacement = () => `new GoogleGenAI({ apiKey: ${ctx.edits.render(first)}${pin} })`;
      }
    } else if (!first || !Node.isObjectLiteralExpression(first)) {
      ctx.todo(ne, "dynamic-model-params", { detail: "client constructor argument" });
    } else {
      const props = first.getProperties();
      const unknown = props.find(
        (p) => !(Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p)) || !VERTEX_OPTION_KEYS.has(p.getName()),
      );
      if (unknown) {
        ctx.todo(unknown, Node.isSpreadAssignment(unknown) ? "dynamic-model-params" : "request-options", {
          detail: "client constructor option",
        });
      } else {
        replacement = () => {
          const parts = ["vertexai: true", ...props.map((p) => ctx.edits.render(p))];
          return `new GoogleGenAI({ ${parts.join(", ")}${pin} })`;
        };
      }
    }

    if (replacement) {
      ctx.edits.replace(ne, replacement);
      if (keep) ctx.warn(ne, "api-version-pinned", { version: PINNED_VERSION[kind] });
      else ctx.warn(ne, kind === "gemini" ? "api-version-default-changed" : "vertex-api-version-default-changed");
    }

    const migrated = replacement !== undefined;
    const holder = ne.getParent();
    if (Node.isVariableDeclaration(holder) && holder.getInitializer() === ne) {
      const nameNode = holder.getNameNode();
      if (Node.isIdentifier(nameNode)) clients.set(nameNode.getText(), { kind, name: nameNode.getText(), migrated });
    } else if (
      // export default new GoogleGenerativeAI(key) / module.exports = new GoogleGenerativeAI(key)
      (Node.isExportAssignment(holder) && !holder.isExportEquals()) ||
      (Node.isBinaryExpression(holder) && holder.getRight() === ne && holder.getLeft().getText() === "module.exports")
    ) {
      clients.set(DIRECT_DEFAULT_EXPORT, { kind, name: DIRECT_DEFAULT_EXPORT, migrated, node: holder });
    }
  }

  checkVertexPreview(ctx, clients);
  return clients;
}

/** vertexAI.preview.* has no automatic rewrite (local clients and clients imported from another file). */
export function checkVertexPreview(ctx: Ctx, clients: Map<string, ClientInfo>): void {
  for (const pa of ctx.sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const target = pa.getExpression();
    if (pa.getName() === "preview" && Node.isIdentifier(target) && clients.get(target.getText())?.kind === "vertex") {
      ctx.todo(pa, "vertex-preview");
    }
  }
}
