import type { Node, SourceFile } from "ts-morph";
import type { Vars } from "../i18n.js";
import type { EditSet } from "./edits.js";

export type ApiVersionMode = "keep" | "sdk-default";

export interface TransformOptions {
  apiVersion: ApiVersionMode;
  /**
   * Cross-module lookup (set by the CLI in its second pass): what the module `specifier`,
   * imported from this file, exports under `name` ("default", a name, or "*" for a namespace).
   */
  lookupImport?: (specifier: string, name: string) => ExportedLegacy | undefined;
}

/** An old-SDK client or model handle that a file exports, so importers can follow it. */
export type ExportedLegacy =
  | { name: string; kind: "client"; clientKind: ClientKind; migrated: boolean; line: number; column: number }
  | { name: string; kind: "handle"; line: number; column: number };

export interface Finding {
  /** Stable English identifier, e.g. "text-throws-on-block". */
  code: string;
  line: number;
  column: number;
  /** Values for the message template. */
  vars: Vars;
}

export interface TransformResult {
  output: string;
  changed: boolean;
  /** True when the file imported a legacy Google SDK (used for package.json checks). */
  legacy: boolean;
  todos: Finding[];
  warnings: Finding[];
  /** Old-SDK clients and handles this file exports (for the CLI's cross-module pass). */
  exports: ExportedLegacy[];
}

export type ClientKind = "gemini" | "vertex";

export interface ClientInfo {
  kind: ClientKind;
  /** Variable name that holds the client. */
  name: string;
  /** True when the constructor was rewritten to new GoogleGenAI(...). */
  migrated: boolean;
  /** Set when the client is imported from another file (module specifier). */
  importedFrom?: string;
  /** The constructor node, for `export default new GoogleGenerativeAI(...)`. */
  node?: Node;
}

/** Shared state for one file's transformation. */
export interface Ctx {
  sf: SourceFile;
  /** Original source text. */
  text: string;
  edits: EditSet;
  opts: TransformOptions;
  /** Local names bound by relative imports -> module specifier (for cross-module TODOs). */
  importedFrom: Map<string, string>;
  todo(node: Node, code: string, vars?: Vars): void;
  warn(node: Node, code: string, vars?: Vars): void;
}
