/** Dependency-free line diff (Myers O(ND)) rendered as a unified diff. */

type Op = { kind: " " | "-" | "+"; text: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function myers(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  let v = new Array<number>(2 * max + 2).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) x = v[offset + k + 1] ?? 0;
      else x = (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d, offset);
    }
    v = v.slice();
  }
  return [];
}

function backtrack(trace: number[][], a: string[], b: string[], dEnd: number, offset: number): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d] ?? [];
    const k = x - y;
    const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: " ", text: a[x - 1] ?? "" });
      x--;
      y--;
    }
    if (down) ops.push({ kind: "+", text: b[y - 1] ?? "" });
    else ops.push({ kind: "-", text: a[x - 1] ?? "" });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: " ", text: a[x - 1] ?? "" });
    x--;
    y--;
  }
  return ops.reverse();
}

export interface DiffStyle {
  color: boolean;
}

/** Unified diff with 3 lines of context; empty string when the texts are equal. */
export function unifiedDiff(path: string, before: string, after: string, style: DiffStyle = { color: false }): string {
  if (before === after) return "";
  const a = splitLines(before);
  const b = splitLines(after);
  // Trim the common prefix and suffix so the Myers search only sees the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = [
    ...a.slice(0, start).map((text): Op => ({ kind: " ", text })),
    ...myers(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text): Op => ({ kind: " ", text })),
  ];

  const paint = (code: string, text: string): string => (style.color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const context = 3;
  const changed = ops.map((op) => op.kind !== " ");
  const out: string[] = [paint("1", `--- a/${path}`), paint("1", `+++ b/${path}`)];

  let i = 0;
  while (i < ops.length) {
    if (!changed[i]) {
      i++;
      continue;
    }
    const from = Math.max(0, i - context);
    let to = i;
    let j = i;
    while (j < ops.length) {
      if (changed[j]) {
        to = j;
        j++;
      } else if (changed.slice(j, j + 2 * context + 1).some(Boolean)) {
        j++;
      } else break;
    }
    const end = Math.min(ops.length, to + context + 1);
    let oldLine = 1;
    let newLine = 1;
    for (const op of ops.slice(0, from)) {
      if (op.kind !== "+") oldLine++;
      if (op.kind !== "-") newLine++;
    }
    const slice = ops.slice(from, end);
    const oldCount = slice.filter((o) => o.kind !== "+").length;
    const newCount = slice.filter((o) => o.kind !== "-").length;
    out.push(paint("36", `@@ -${oldCount === 0 ? oldLine - 1 : oldLine},${oldCount} +${newCount === 0 ? newLine - 1 : newLine},${newCount} @@`));
    for (const op of slice) {
      const line = op.kind + op.text;
      out.push(op.kind === "-" ? paint("31", line) : op.kind === "+" ? paint("32", line) : line);
    }
    i = end;
  }
  return out.join("\n");
}
