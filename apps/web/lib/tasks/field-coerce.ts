/**
 * Custom-field value coercion (0116) — ONE rule set for every writer: the task
 * sidebar / list cells (typed values), workflow `action.task.set_field` and
 * the AI `set_task_field` tool (free text), and forms → fields. Pure; the DB
 * lookups a type needs (members, tasks) are handed in as `ctx`.
 *
 * Returns the canonical stored value (`null` = clear the field) or an error
 * message a person can act on.
 */
import type {
  CustomFieldConfig,
  CustomFieldOption,
  CustomFieldType,
} from "@/lib/db/types";

export type CoerceField = {
  name: string;
  type: CustomFieldType;
  options?: CustomFieldOption[] | null;
  config?: CustomFieldConfig | null;
};

export type CoerceMember = { id: string; name?: string | null; email?: string | null };
export type CoerceTask = { id: string; title: string; key?: string | null; list_id?: string | null };

export type CoerceCtx = {
  members?: CoerceMember[];
  tasks?: CoerceTask[];
};

export type StoredFieldValue = string | number | boolean | string[];
export type CoerceResult =
  | { ok: true; value: StoredFieldValue | null }
  | { ok: false; error: string };

export const TEXT_MAX = 500;
export const LONG_TEXT_MAX = 5000;
export const MAX_REFS = 50;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRUE_WORDS = ["true", "yes", "y", "1", "checked", "on", "x"];
const FALSE_WORDS = ["false", "no", "n", "0", "unchecked", "off", ""];

/** Types whose value is computed / derived and never written by a caller. */
export const READ_ONLY_FIELD_TYPES: readonly CustomFieldType[] = ["files", "progress"];
export function isReadOnlyFieldType(type: CustomFieldType): boolean {
  return READ_ONLY_FIELD_TYPES.includes(type);
}

/** Types whose stored value is an array of ids. */
export function isRefListType(type: CustomFieldType): boolean {
  return type === "people" || type === "relation" || type === "files" || type === "multi_select";
}

const ok = (value: StoredFieldValue | null): CoerceResult => ({ ok: true, value });
const fail = (error: string): CoerceResult => ({ ok: false, error });

function isEmpty(raw: unknown): boolean {
  return (
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "") ||
    (Array.isArray(raw) && raw.length === 0)
  );
}

/** "a, b" / ["a","b"] / "a" → trimmed tokens. */
function tokens(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,\n;]/);
  return list.map((t) => String(t).trim()).filter(Boolean);
}

/** Parse "1,250.60", "KES 1 250", "$-3.5" → number. Plain decimals only. */
export function parseLooseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\s,_]/g, "").replace(/^[A-Za-z$€£¥₹]+/, "").replace(/[A-Za-z$€£¥₹]+$/, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function currencyPrecision(config?: CustomFieldConfig | null): number {
  const p = config?.precision;
  return typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 4 ? p : 2;
}

function roundTo(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** "example.com/x" → "https://example.com/x"; only http(s) survives. */
export function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function matchOption(options: CustomFieldOption[], token: string): CustomFieldOption | undefined {
  const t = token.trim().toLowerCase();
  return options.find((o) => o.id === token.trim() || o.label.toLowerCase() === t);
}

function matchMember(members: CoerceMember[], token: string): CoerceMember | undefined {
  if (UUID_RE.test(token)) return members.find((m) => m.id === token);
  const t = token.toLowerCase();
  return (
    members.find((m) => (m.name ?? "").toLowerCase() === t) ??
    members.find((m) => (m.email ?? "").toLowerCase() === t) ??
    members.find((m) => (m.name ?? "").toLowerCase().includes(t))
  );
}

function matchTask(tasks: CoerceTask[], token: string): CoerceTask | undefined {
  if (UUID_RE.test(token)) return tasks.find((x) => x.id === token);
  const t = token.toLowerCase();
  return (
    tasks.find((x) => (x.key ?? "").toLowerCase() === t) ??
    tasks.find((x) => x.title.toLowerCase() === t)
  );
}

export function coerceFieldValue(
  field: CoerceField,
  raw: unknown,
  ctx: CoerceCtx = {},
): CoerceResult {
  if (field.type === "progress") {
    return fail(`${field.name} is computed from sub-issues and checklists — it can't be set`);
  }
  if (field.type === "files") {
    return fail(`${field.name} is filled by attaching files to it — it can't be set directly`);
  }
  if (isEmpty(raw)) return ok(null);

  const options = field.options ?? [];
  switch (field.type) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string" && typeof raw !== "number") return fail("Expected text");
      const max = field.type === "text" ? TEXT_MAX : LONG_TEXT_MAX;
      const s = String(raw);
      if (s.length > max) return fail(`Too long (max ${max} characters)`);
      return ok(field.type === "text" ? s.trim() : s);
    }
    case "number": {
      const n = parseLooseNumber(raw);
      return n === null ? fail(`"${String(raw)}" is not a number`) : ok(n);
    }
    case "currency": {
      const n = parseLooseNumber(raw);
      if (n === null) return fail(`"${String(raw)}" is not an amount`);
      return ok(roundTo(n, currencyPrecision(field.config)));
    }
    case "checkbox": {
      if (typeof raw === "boolean") return ok(raw);
      const s = String(raw).trim().toLowerCase();
      if (TRUE_WORDS.includes(s)) return ok(true);
      if (FALSE_WORDS.includes(s)) return ok(false);
      return fail(`"${String(raw)}" is not yes/no`);
    }
    case "date": {
      if (typeof raw !== "string") return fail("Expected a date (YYYY-MM-DD)");
      const s = raw.trim();
      if (DATE_RE.test(s)) return ok(s);
      // An ISO timestamp keeps its calendar day.
      if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))) return ok(s.slice(0, 10));
      return fail(`"${s}" is not a date — use YYYY-MM-DD`);
    }
    case "url": {
      if (typeof raw !== "string") return fail("Expected a link");
      const u = normalizeUrl(raw);
      return u ? ok(u) : fail(`"${raw}" is not a web link`);
    }
    case "email": {
      if (typeof raw !== "string" || !EMAIL_RE.test(raw.trim())) return fail("Enter a valid email address");
      return ok(raw.trim().toLowerCase());
    }
    case "phone": {
      const s = String(raw).trim();
      if (s.replace(/[^0-9+]/g, "").length < 5 || s.length > 40) return fail("Enter a valid phone number");
      return ok(s);
    }
    case "select": {
      const list = tokens(raw);
      if (list.length !== 1) return fail(`${field.name} takes one option`);
      const hit = matchOption(options, list[0]!);
      return hit
        ? ok(hit.id)
        : fail(`"${list[0]}" is not an option on ${field.name} (${options.map((o) => o.label).join(", ")})`);
    }
    case "multi_select": {
      const picked: string[] = [];
      for (const t of tokens(raw)) {
        const hit = matchOption(options, t);
        if (!hit) {
          return fail(`"${t}" is not an option on ${field.name} (${options.map((o) => o.label).join(", ")})`);
        }
        picked.push(hit.id);
      }
      // Canonical (definition) order, de-duplicated — the change trigger
      // compares arrays element-wise, so a reorder must not look like an edit.
      const ids = options.map((o) => o.id).filter((id) => picked.includes(id));
      return ok(ids.length > 0 ? ids : null);
    }
    case "people": {
      const members = ctx.members ?? [];
      const ids: string[] = [];
      for (const t of tokens(raw)) {
        const hit = matchMember(members, t);
        if (!hit) {
          return fail(
            `No member matches "${t}"${members.length ? ` (${members.map((m) => m.name).filter(Boolean).slice(0, 12).join(", ")})` : ""}`,
          );
        }
        if (!ids.includes(hit.id)) ids.push(hit.id);
      }
      if (field.config?.multiple === false && ids.length > 1) {
        return fail(`${field.name} takes one person`);
      }
      if (ids.length > MAX_REFS) return fail(`Too many people (max ${MAX_REFS})`);
      return ok(ids.length > 0 ? ids : null);
    }
    case "relation": {
      const tasks = ctx.tasks ?? [];
      const target = field.config?.target_list_id ?? null;
      const ids: string[] = [];
      for (const t of tokens(raw)) {
        const hit = matchTask(tasks, t);
        if (!hit) return fail(`No task matches "${t}" — use its key (e.g. GHV-12) or exact title`);
        if (target && hit.list_id && hit.list_id !== target) {
          return fail(`"${hit.title}" is not in the list ${field.name} links to`);
        }
        if (!ids.includes(hit.id)) ids.push(hit.id);
      }
      if (ids.length > MAX_REFS) return fail(`Too many tasks (max ${MAX_REFS})`);
      return ok(ids.length > 0 ? ids : null);
    }
  }
}

/** Which lookups `coerceFieldValue` needs for a type (so callers fetch only those). */
export function coerceNeeds(type: CustomFieldType): { members: boolean; tasks: boolean } {
  return { members: type === "people", tasks: type === "relation" };
}
