/**
 * One-shot hand-off for the "Generate doc from a prompt" flow.
 *
 * The Generate dialog creates an empty document, then navigates to it. The
 * editor (`EditorInner`) can't receive the prompt through the URL without
 * leaking it into history, so the dialog stashes it here keyed by the new doc
 * id and the editor consumes it exactly once on mount — firing the doc-bot and
 * applying the result as a staged (green) AI suggestion the user accepts.
 *
 * Module-level Map (not React state / context) because the producer and the
 * consumer live on opposite sides of a route navigation that may remount the
 * whole surface tree. `take()` deletes the entry so a reload never re-triggers
 * generation.
 */
const pending = new Map<string, string>();

/** Stash the generation prompt for `documentId`. */
export function setPendingGeneration(documentId: string, prompt: string): void {
  pending.set(documentId, prompt);
}

/** Consume (and clear) the generation prompt for `documentId`, if any. */
export function takePendingGeneration(documentId: string): string | null {
  const prompt = pending.get(documentId);
  if (prompt === undefined) return null;
  pending.delete(documentId);
  return prompt;
}
