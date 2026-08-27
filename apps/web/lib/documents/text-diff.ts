/**
 * Pure line-level text diff with word-level refinement, for the AI revision
 * viewer (components/documents/ai-revisions-panel.tsx). Plain LCS over
 * lines, then paired changed lines get a word-level LCS so the actual
 * edited words highlight — the Beautiful UI CodeBlock diff anatomy.
 *
 * Deliberately dependency-free and capped: revision bodies are document
 * text (KBs, not MBs), and anything past the cap degrades to "too large to
 * diff" rather than an O(n·m) stall.
 */

export type DiffSegment = { text: string; changed: boolean };

export type DiffRow =
  | { kind: "same"; text: string; oldLine: number; newLine: number }
  | { kind: "del"; text: string; oldLine: number; segments?: DiffSegment[] }
  | { kind: "add"; text: string; newLine: number; segments?: DiffSegment[] }
  | { kind: "skip"; count: number };

const MAX_LINES = 1500;
/** Runs of unchanged lines longer than this collapse to a "skip" row. */
const CONTEXT = 3;

function lcsTable(a: string[], b: string[]): Uint32Array {
  const w = b.length + 1;
  const table = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] =
        a[i] === b[j]
          ? table[(i + 1) * w + j + 1] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  return table;
}

function diffSequences(
  a: string[],
  b: string[],
): { kind: "same" | "del" | "add"; text: string; ai: number; bi: number }[] {
  const table = lcsTable(a, b);
  const w = b.length + 1;
  const out: { kind: "same" | "del" | "add"; text: string; ai: number; bi: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], ai: i, bi: j });
      i++;
      j++;
    } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
      out.push({ kind: "del", text: a[i], ai: i, bi: j });
      i++;
    } else {
      out.push({ kind: "add", text: b[j], ai: i, bi: j });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ kind: "del", text: a[i], ai: i, bi: j });
  for (; j < b.length; j++) out.push({ kind: "add", text: b[j], ai: i, bi: j });
  return out;
}

/** Word-level segments for a changed old/new line pair. */
function wordSegments(oldLine: string, newLine: string): {
  del: DiffSegment[];
  add: DiffSegment[];
} {
  const tokenize = (s: string) => s.split(/(\s+)/).filter((t) => t.length > 0);
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  if (a.length * b.length > 40_000) {
    return {
      del: [{ text: oldLine, changed: true }],
      add: [{ text: newLine, changed: true }],
    };
  }
  const ops = diffSequences(a, b);
  const del: DiffSegment[] = [];
  const add: DiffSegment[] = [];
  for (const op of ops) {
    if (op.kind === "same") {
      del.push({ text: op.text, changed: false });
      add.push({ text: op.text, changed: false });
    } else if (op.kind === "del") {
      del.push({ text: op.text, changed: true });
    } else {
      add.push({ text: op.text, changed: true });
    }
  }
  const merge = (segments: DiffSegment[]) =>
    segments.reduce<DiffSegment[]>((acc, seg) => {
      const last = acc[acc.length - 1];
      if (last && last.changed === seg.changed) last.text += seg.text;
      else acc.push({ ...seg });
      return acc;
    }, []);
  return { del: merge(del), add: merge(add) };
}

export function diffText(
  oldText: string,
  newText: string,
): { rows: DiffRow[]; tooLarge: boolean; changed: boolean } {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return { rows: [], tooLarge: true, changed: oldText !== newText };
  }

  const ops = diffSequences(a, b);
  const rows: DiffRow[] = [];
  let changed = false;

  // Pair consecutive del/add runs for word-level refinement.
  for (let k = 0; k < ops.length; ) {
    const op = ops[k];
    if (op.kind === "same") {
      rows.push({ kind: "same", text: op.text, oldLine: op.ai + 1, newLine: op.bi + 1 });
      k++;
      continue;
    }
    changed = true;
    const dels: typeof ops = [];
    const adds: typeof ops = [];
    while (k < ops.length && ops[k].kind === "del") dels.push(ops[k++]);
    while (k < ops.length && ops[k].kind === "add") adds.push(ops[k++]);
    dels.forEach((d, idx) => {
      const paired = idx < adds.length ? wordSegments(d.text, adds[idx].text) : null;
      rows.push({ kind: "del", text: d.text, oldLine: d.ai + 1, segments: paired?.del });
    });
    adds.forEach((aOp, idx) => {
      const paired = idx < dels.length ? wordSegments(dels[idx].text, aOp.text) : null;
      rows.push({ kind: "add", text: aOp.text, newLine: aOp.bi + 1, segments: paired?.add });
    });
  }

  // Collapse long unchanged runs, keeping CONTEXT lines on each side.
  const collapsed: DiffRow[] = [];
  for (let k = 0; k < rows.length; ) {
    if (rows[k].kind !== "same") {
      collapsed.push(rows[k]);
      k++;
      continue;
    }
    let end = k;
    while (end < rows.length && rows[end].kind === "same") end++;
    const run = end - k;
    const leading = k === 0 ? 0 : CONTEXT;
    const trailing = end === rows.length ? 0 : CONTEXT;
    if (run > leading + trailing + 2) {
      for (let x = k; x < k + leading; x++) collapsed.push(rows[x]);
      collapsed.push({ kind: "skip", count: run - leading - trailing });
      for (let x = end - trailing; x < end; x++) collapsed.push(rows[x]);
    } else {
      for (let x = k; x < end; x++) collapsed.push(rows[x]);
    }
    k = end;
  }

  return { rows: collapsed, tooLarge: false, changed };
}
