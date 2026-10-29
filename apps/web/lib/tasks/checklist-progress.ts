/**
 * Per-task checklists (0117) — pure helpers shared by the panel, the card
 * chip, the Progress field / column and the server writers.
 */

export type ChecklistItemLike = {
  id: string;
  parent_item_id: string | null;
  position: number;
  done: boolean;
};

export type NestedItem<T extends ChecklistItemLike> = T & { children: T[] };

/** Top-level items in order, each with its (one level of) children in order. */
export function nestItems<T extends ChecklistItemLike>(items: T[]): NestedItem<T>[] {
  const byPos = (a: T, b: T) => a.position - b.position || a.id.localeCompare(b.id);
  const top = items.filter((i) => !i.parent_item_id).sort(byPos);
  const topIds = new Set(top.map((i) => i.id));
  return top.map((parent) => ({
    ...parent,
    children: items.filter((i) => i.parent_item_id === parent.id).sort(byPos),
  })).concat(
    // Orphans (parent deleted mid-flight) surface at the top level rather than vanish.
    items
      .filter((i) => i.parent_item_id && !topIds.has(i.parent_item_id))
      .sort(byPos)
      .map((i) => ({ ...i, children: [] })),
  );
}

/** "3/7" counts for one checklist's items. */
export function checklistCounts(items: { done: boolean }[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/**
 * A task's progress = done sub-issues + done checklist items over all of
 * them (ClickUp's auto-progress). `null` when there is nothing to measure.
 */
export function progressFor(args: {
  subIssuesDone: number;
  subIssuesTotal: number;
  checklistDone?: number | null;
  checklistTotal?: number | null;
}): { done: number; total: number; pct: number } | null {
  const done = args.subIssuesDone + (args.checklistDone ?? 0);
  const total = args.subIssuesTotal + (args.checklistTotal ?? 0);
  if (total <= 0) return null;
  return { done, total, pct: Math.round((done / total) * 100) };
}

/** Position for an item dropped between two neighbours (fractional ladder). */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1024;
  if (before === null) return (after as number) - 1024;
  if (after === null) return before + 1024;
  return (before + after) / 2;
}

export type ParsedChecklistLine = { text: string; done: boolean; children: { text: string; done: boolean }[] };

/**
 * Paste-a-list parsing: one item per line; "- [x] Keys" marks done; an
 * indented line (2+ spaces or a tab) nests under the previous item. Bullets
 * and numbering are stripped. Caps at 200 items, 500 chars each.
 */
export function parseChecklistText(text: string): ParsedChecklistLine[] {
  const out: ParsedChecklistLine[] = [];
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || count >= 200) continue;
    const indented = /^(\t| {2,})/.test(raw);
    let line = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, "");
    let done = false;
    const box = /^\[( |x|X)\]\s*/.exec(line);
    if (box) {
      done = box[1] !== " ";
      line = line.slice(box[0].length);
    }
    line = line.slice(0, 500).trim();
    if (!line) continue;
    count += 1;
    const prev = out[out.length - 1];
    if (indented && prev) prev.children.push({ text: line, done });
    else out.push({ text: line, done, children: [] });
  }
  return out;
}
