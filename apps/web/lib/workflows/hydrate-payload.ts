import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Add human-readable names beside the raw people ids in a trigger payload.
 *
 * WHY: trigger payloads come from Postgres triggers, so a task event carries
 * `assignee_id` — a uuid. Workflow steps are templated, so an author writing
 * the obvious thing ("*Assignee:* {{trigger.new.assignee_id}}") posts
 * `33831554-d1a7-4f62-85a5-85952cbc11e4` into a chat channel. Verified live:
 * that is exactly what landed in #food-and-beverage before this existed.
 *
 * Rather than teach every author and every template to join against profiles,
 * the dispatcher hydrates the payload ONCE, before filters run and before the
 * run starts, so `{{trigger.new.assignee_name}}` is available everywhere
 * `assignee_id` is — including inside trigger filters ("when it's assigned to
 * Maria") and the Insert-data picker.
 *
 * Deterministic and fail-soft: a lookup failure leaves the payload untouched,
 * which degrades to the old behaviour rather than breaking the run.
 */

/**
 * Payload keys holding a user id, mapped to the name key we add beside them.
 * Keep this list conservative — a key added here changes what every workflow
 * can reference.
 */
const PEOPLE_ID_KEYS: Record<string, string> = {
  assignee_id: "assignee_name",
  created_by: "created_by_name",
  updated_by: "updated_by_name",
  user_id: "user_name",
  lead_user_id: "lead_user_name",
};

/** The nested objects a trigger payload puts records under. */
const RECORD_KEYS = ["new", "old", "task", "record", "entity"] as const;

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every user id referenced anywhere in the payload (top level + one nest). */
function collectUserIds(payload: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const scan = (obj: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(obj)) {
      if (!(key in PEOPLE_ID_KEYS)) continue;
      if (typeof value === "string" && UUID_RX.test(value)) ids.add(value);
    }
  };
  scan(payload);
  for (const key of RECORD_KEYS) {
    const nested = payload[key];
    if (isRecord(nested)) scan(nested);
  }
  return ids;
}

function applyNames(
  obj: Record<string, unknown>,
  names: Map<string, string>,
): Record<string, unknown> {
  const out = { ...obj };
  for (const [idKey, nameKey] of Object.entries(PEOPLE_ID_KEYS)) {
    const raw = obj[idKey];
    // Only fill a name we don't already have, so an emitter that supplies its
    // own (better) name always wins.
    if (out[nameKey] !== undefined) continue;
    if (typeof raw !== "string") continue;
    const name = names.get(raw);
    if (name) out[nameKey] = name;
  }
  return out;
}

export async function hydrateTriggerPayload(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ids = collectUserIds(payload);
  if (ids.size === 0) return payload;

  let names: Map<string, string>;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...ids]);
    if (error) {
      console.warn("[workflows:hydrate] profile lookup failed:", error.message);
      return payload;
    }
    names = new Map(
      (data ?? [])
        .filter((p): p is { id: string; full_name: string } =>
          Boolean(p.full_name),
        )
        .map((p) => [p.id, p.full_name]),
    );
  } catch (err) {
    // Fail-soft, but never silently: a transient Supabase DNS/connection blip
    // here degrades every message that references a person back to raw uuids,
    // and a bare catch makes that indistinguishable from "no ids present".
    console.warn(
      "[workflows:hydrate] profile lookup threw:",
      err instanceof Error ? err.message : err,
    );
    return payload;
  }
  if (names.size === 0) {
    console.warn(
      `[workflows:hydrate] no named profiles for ${ids.size} id(s) — leaving raw`,
    );
    return payload;
  }

  const out = applyNames(payload, names);
  for (const key of RECORD_KEYS) {
    const nested = out[key];
    if (isRecord(nested)) out[key] = applyNames(nested, names);
  }
  return out;
}
