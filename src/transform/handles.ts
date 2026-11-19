import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression, ObjectLiteralExpression, VariableDeclaration } from "ts-morph";
import { removeStatement } from "./imports.js";
import { trackCallResult } from "./responses.js";
import type { ClientInfo, Ctx } from "./types.js";

/** Keys of the legacy model options that move into `config` as they are. */
const CONFIG_KEYS = new Set(["systemInstruction", "safetySettings", "tools", "toolConfig", "cachedContent"]);
const CALL_METHODS = new Set(["generateContent", "generateContentStream", "countTokens", "embedContent", "startChat"]);

interface Handle {
  decl: VariableDeclaration;
  client: ClientInfo;
  unsafe: boolean;
  /** Edits to register once the whole handle is known to be safe. */
  ops: Array<() => void>;
  model: () => string;
  config: () => string[];
}

function hasProperty(obj: ObjectLiteralExpression, name: string): boolean {
  return obj.getProperties().some((p) => (Node.isPropertyAssignment(p) || Node.isShorthandPropertyAssignment(p)) && p.getName() === name);
}

/**
 * Tracks `const model = genAI.getGenerativeModel({...})` handles, moves their settings to every
 * call site and removes the declaration once nothing else refers to it.
 */
export function rewriteHandles(ctx: Ctx, clients: Map<string, ClientInfo>): void {
  const processed = new Set<Node>();

  for (const decl of ctx.sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "getGenerativeModel") continue;
    const receiver = callee.getExpression();
    const client = Node.isIdentifier(receiver) ? clients.get(receiver.getText()) : undefined;
    if (!client) continue;
    processed.add(init);

    const handle = buildHandle(ctx, decl, init, client);
    // A handle that is already unsafe is left untouched; scanning its uses would only add noise.
    if (handle && !handle.unsafe) collectUses(ctx, handle);
    if (handle && !handle.unsafe) {
      for (const op of handle.ops) op();
      const statement = decl.getVariableStatement();
      if (statement && statement.getDeclarations().length === 1) removeStatement(ctx, statement);
    }
  }

  // Any getGenerativeModel call we did not understand is reported, also in already-migrated files.
  for (const call of ctx.sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || processed.has(call)) continue;
    if (callee.getName() === "getGenerativeModel") {
      // genAI imported from "./client.js" that this run could not follow (not scanned, or not rewritten there)
      const receiver = callee.getExpression();
      const tracked = Node.isIdentifier(receiver) && clients.has(receiver.getText());
      const module = Node.isIdentifier(receiver) && !tracked ? ctx.importedFrom.get(receiver.getText()) : undefined;
      if (tracked) ctx.todo(call, "handle-escapes", { detail: "getGenerativeModel() result is not stored in a const" });
      else if (module) ctx.todo(call, "cross-module", { name: receiver.getText(), module, detail: "getGenerativeModel()" });
      else ctx.todo(call, "handle-escapes", { detail: "getGenerativeModel on an untracked client" });
    } else if (callee.getName() === "getGenerativeModelFromCachedContent") {
      ctx.todo(call, "server-managers");
    }
  }
}

function buildHandle(ctx: Ctx, decl: VariableDeclaration, init: CallExpression, client: ClientInfo): Handle | undefined {
  const nameNode = decl.getNameNode();
  if (!Node.isIdentifier(nameNode)) {
    ctx.todo(decl, "handle-escapes", { detail: "destructured model handle" });
    return undefined;
  }
  const [options, extra] = init.getArguments();
  let unsafe = false;

  if (extra) {
    ctx.todo(extra, "request-options");
    unsafe = true;
  }
  if (decl.getVariableStatement()?.isExported()) {
    ctx.todo(decl, "handle-escapes", { detail: "exported model handle" });
    unsafe = true;
  }
  if (!options || !Node.isObjectLiteralExpression(options)) {
    ctx.todo(init, "dynamic-model-params", { detail: "model options are not an object literal" });
    return undefined;
  }

  let modelNode: Node | undefined;
  const entries: Array<() => string> = [];
  for (const prop of options.getProperties()) {
    if (!(Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop))) {
      ctx.todo(prop, "dynamic-model-params", { detail: "spread or computed option" });
      unsafe = true;
      continue;
    }
    const key = prop.getName();
    if (key === "model") {
      modelNode = Node.isPropertyAssignment(prop) ? prop.getInitializer() : prop.getNameNode();
    } else if (key === "generationConfig") {
      const value = Node.isPropertyAssignment(prop) ? prop.getInitializer() : prop.getNameNode();
      if (value && Node.isObjectLiteralExpression(value)) {
        for (const inner of value.getProperties()) entries.push(() => ctx.edits.render(inner));
      } else if (value) {
        entries.push(() => `...${ctx.edits.render(value)}`);
      }
    } else if (CONFIG_KEYS.has(key)) {
      entries.push(() => ctx.edits.render(prop));
    } else {
      ctx.todo(prop, "dynamic-model-params", { detail: `option "${key}"` });
      unsafe = true;
    }
  }
  if (!modelNode) {
    ctx.todo(init, "dynamic-model-params", { detail: "no model option" });
    return undefined;
  }
  const modelValue = modelNode;
  return {
    decl,
    client,
    unsafe,
    ops: [],
    model: () => ctx.edits.render(modelValue),
    config: () => entries.map((e) => e()),
  };
}

function configPart(entries: string[]): string {
  return entries.length > 0 ? `, config: { ${entries.join(", ")} }` : "";
}

function collectUses(ctx: Ctx, handle: Handle): void {
  const nameNode = handle.decl.getNameNode();
  if (!Node.isIdentifier(nameNode)) return;
  const refs = nameNode.findReferencesAsNodes().filter((r) => r.getSourceFile() === ctx.sf && r !== nameNode);

  for (const ref of refs) {
    const member = ref.getParent();
    const call = member?.getParent();
    const isCallee =
      member && Node.isPropertyAccessExpression(member) && member.getExpression() === ref && call && Node.isCallExpression(call) && call.getExpression() === member;
    if (!isCallee || !Node.isPropertyAccessExpression(member) || !Node.isCallExpression(call)) {
      ctx.todo(ref, "handle-escapes", { detail: "the model handle is passed around or returned" });
      handle.unsafe = true;
      continue;
    }
    const method = member.getName();
    if (!CALL_METHODS.has(method)) {
      ctx.todo(ref, "handle-escapes", { detail: `.${method}()` });
      handle.unsafe = true;
      continue;
    }
    planCall(ctx, handle, call, method);
  }
}

function planCall(ctx: Ctx, handle: Handle, call: CallExpression, method: string): void {
  const client = handle.client.name;
  const args = call.getArguments();
  const arg = args[0];

  if (method === "startChat") {
    planChat(ctx, handle, call);
    return;
  }

  const bad = !arg || args.length !== 1 || Node.isSpreadElement(arg) || (Node.isObjectLiteralExpression(arg) && (hasProperty(arg, "contents") || method === "embedContent"));
  if (bad || !arg) {
    ctx.todo(call, "dynamic-model-params", { detail: `${method} arguments` });
    handle.unsafe = true;
    return;
  }

  handle.ops.push(() => {
    const withConfig = method === "generateContent" || method === "generateContentStream";
    ctx.edits.replace(call, () => {
      const cfg = withConfig ? configPart(handle.config()) : "";
      return `${client}.models.${method}({ model: ${handle.model()}, contents: ${ctx.edits.render(arg)}${cfg} })`;
    });
    const kind = method === "generateContent" ? "generate" : method === "generateContentStream" ? "stream" : method === "embedContent" ? "embed" : "count";
    trackCallResult(ctx, call, kind);
  });
}

function planChat(ctx: Ctx, handle: Handle, call: CallExpression): void {
  const client = handle.client.name;
  const holder = call.getParent();
  const chatName = Node.isVariableDeclaration(holder) && holder.getInitializer() === call ? holder.getNameNode() : undefined;
  if (!chatName || !Node.isIdentifier(chatName)) {
    ctx.todo(call, "handle-escapes", { detail: "the chat session is not stored in a simple const" });
    handle.unsafe = true;
    return;
  }
  const [opts, ...rest] = call.getArguments();
  if (rest.length > 0 || (opts && !Node.isObjectLiteralExpression(opts))) {
    ctx.todo(call, "dynamic-model-params", { detail: "startChat arguments" });
    handle.unsafe = true;
    return;
  }
  const history: Array<() => string> = [];
  const extra: Array<() => string> = [];
  for (const prop of opts && Node.isObjectLiteralExpression(opts) ? opts.getProperties() : []) {
    const key = Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop) ? prop.getName() : undefined;
    if (key === "history") {
      history.push(() => ctx.edits.render(prop));
    } else if (key === "generationConfig" && Node.isPropertyAssignment(prop) && Node.isObjectLiteralExpression(prop.getInitializer())) {
      const value = prop.getInitializer();
      if (value && Node.isObjectLiteralExpression(value)) for (const inner of value.getProperties()) extra.push(() => ctx.edits.render(inner));
    } else if (key && CONFIG_KEYS.has(key)) {
      extra.push(() => ctx.edits.render(prop));
    } else {
      ctx.todo(prop, "dynamic-model-params", { detail: "startChat option" });
      handle.unsafe = true;
      return;
    }
  }

  handle.ops.push(() => {
    ctx.edits.replace(call, () => {
      const parts = [`model: ${handle.model()}`, ...history.map((h) => h())];
      const cfg = [...handle.config(), ...extra.map((e) => e())];
      return `${client}.chats.create({ ${parts.join(", ")}${configPart(cfg)} })`;
    });
    rewriteChatUses(ctx, chatName);
  });
}

/** chat.sendMessage(x) -> chat.sendMessage({ message: x }) and the results that follow. */
function rewriteChatUses(ctx: Ctx, chatName: Node): void {
  if (!Node.isIdentifier(chatName)) return;
  for (const ref of chatName.findReferencesAsNodes()) {
    if (ref.getSourceFile() !== ctx.sf || ref === chatName) continue;
    const member = ref.getParent();
    const call = member?.getParent();
    if (!member || !Node.isPropertyAccessExpression(member) || member.getExpression() !== ref) continue;
    if (!call || !Node.isCallExpression(call) || call.getExpression() !== member) continue;
    const method = member.getName();
    if (method !== "sendMessage" && method !== "sendMessageStream") continue;
    const [arg] = call.getArguments();
    if (!arg || call.getArguments().length !== 1 || Node.isSpreadElement(arg)) {
      ctx.todo(call, "dynamic-model-params", { detail: `${method} arguments` });
      continue;
    }
    ctx.edits.replace(call, () => `${ctx.edits.render(ref)}.${method}({ message: ${ctx.edits.render(arg)} })`);
    trackCallResult(ctx, call, method === "sendMessage" ? "generate" : "stream");
  }
}
