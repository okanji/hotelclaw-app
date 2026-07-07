import { humanizeRef } from "./explain-expr";
import type { RefCandidate } from "./refs";

const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** A value that is exactly one `{{ref}}` and nothing else → its inner path. */
export function pureRefPath(value: string): string | null {
  const m = (value ?? "").match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  return m ? m[1]!.trim() : null;
}

/**
 * Short phrase for a template string on canvas cards and inspector previews.
 * e.g. "{{trigger.new.description}}" → "task description (from trigger)"
 */
export function explainTemplateValue(
  value: unknown,
  refs?: RefCandidate[],
): string | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const bound = pureRefPath(raw);
  if (bound) {
    const cand = refs?.find((r) => r.path === bound);
    const label = cand?.label ?? humanizeRef(bound);
    if (bound.startsWith("trigger.")) return `${label} (from trigger)`;
    if (bound.startsWith("steps.")) {
      const stepPart = bound.split(".")[1];
      const stepName = cand?.group?.replace(/^From “(.+)”$/, "$1") ?? stepPart;
      return `${label} (from ${stepName ?? "earlier step"})`;
    }
    if (bound.startsWith("vars.")) return `${label} (variable)`;
    return label;
  }

  // Mixed template — show a truncated preview with friendly ref names.
  if (raw.includes("{{")) {
    const friendly = raw.replace(TEMPLATE_RE, (_, inner: string) => {
      const path = inner.trim();
      const cand = refs?.find((r) => r.path === path);
      return `⟨${cand?.label ?? humanizeRef(path)}⟩`;
    });
    if (friendly.length > 72) return `${friendly.slice(0, 69)}…`;
    return friendly;
  }

  if (raw.length > 48) return `“${raw.slice(0, 45)}…”`;
  return `“${raw}”`;
}
