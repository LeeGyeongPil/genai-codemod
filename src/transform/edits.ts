import type { Node } from "ts-morph";

/** A text replacement on the ORIGINAL source. `text` is lazy so it can render child ranges. */
interface Edit {
  start: number;
  end: number;
  text: () => string;
}

/**
 * Collects replacements against the original text and applies them in one pass.
 * We never mutate the ts-morph AST, so nodes stay valid and results are deterministic.
 * An outer edit supersedes edits inside its range; it pulls them in with `render()`.
 */
export class EditSet {
  private edits: Edit[] = [];

  constructor(private readonly source: string) {}

  replaceRange(start: number, end: number, text: string | (() => string)): void {
    this.edits.push({ start, end, text: typeof text === "string" ? () => text : text });
  }

  replace(node: Node, text: string | (() => string)): void {
    this.replaceRange(node.getStart(), node.getEnd(), text);
  }

  /** Original text of `node` with every edit that lies strictly inside it applied. */
  render(node: Node): string {
    return this.renderRange(node.getStart(), node.getEnd(), true);
  }

  apply(): string {
    return this.renderRange(0, this.source.length, false);
  }

  hasEdits(): boolean {
    return this.edits.length > 0;
  }

  private renderRange(start: number, end: number, skipExact: boolean): string {
    const inside = this.edits
      .filter((e) => e.start >= start && e.end <= end && !(skipExact && e.start === start && e.end === end))
      .sort((a, b) => a.start - b.start || b.end - a.end);
    let out = "";
    let cursor = start;
    for (const e of inside) {
      if (e.start < cursor) continue; // contained in an edit already applied
      out += this.source.slice(cursor, e.start) + e.text();
      cursor = e.end;
    }
    return out + this.source.slice(cursor, end);
  }
}
