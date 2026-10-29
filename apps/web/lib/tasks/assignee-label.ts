/**
 * The one-line label for an assignee picker (0115): "Assign", "Ana", "Ana +2".
 * `fallbackName` covers callers that only resolved the primary.
 */
export function assigneeSummary(
  ids: readonly string[] | undefined,
  infos: Record<string, { name: string } | undefined> | undefined,
  fallbackName?: string,
): string {
  const list = ids ?? [];
  if (list.length === 0) return fallbackName ?? "Assign";
  const first = infos?.[list[0]!]?.name ?? fallbackName ?? "Member";
  return list.length === 1 ? first : `${first} +${list.length - 1}`;
}
