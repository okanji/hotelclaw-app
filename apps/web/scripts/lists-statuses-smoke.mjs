// Lists + status pipelines smoke (migration 0114) — drives the DB contract
// the web + mobile write paths rely on, with the SERVICE client:
//
//   backfill invariants → legacy insert resolves to the list's open status →
//   legacy `status:'done'` stamps completed_at → status_id-only write resets
//   overdue_notified_at (BEFORE-trigger ordering) → move to a team list syncs
//   space_id → changing space_id re-homes the list → a 21-status custom set
//   remaps by category on a list move → activity_log / workflow_events carry
//   the new names.
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/lists-statuses-smoke.mjs
//
// Hard-cleans everything it creates (task, list, status set, space).

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const PROPERTY_SLUG = process.env.SMOKE_PROPERTY_SLUG ?? "watamu-villa";

function assert(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? `  — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function one(q) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  const property = await one(
    service.from("properties").select("id").eq("slug", PROPERTY_SLUG).single(),
  );
  const pid = property.id;
  const created = { taskIds: [], listIds: [], setIds: [], spaceIds: [] };

  try {
    // ── Backfill invariants ────────────────────────────────────────────────
    const orphans = await one(
      service.from("tasks").select("id", { count: "exact", head: true })
        .eq("property_id", pid).or("list_id.is.null,status_id.is.null"),
    );
    assert("every task has a list and a status", orphans === null);

    const general = await one(
      service.from("lists").select("id, status_set_id").eq("property_id", pid)
        .is("space_id", null).eq("is_default", true).single(),
    );
    const defaultSet = await one(
      service.from("statuses").select("id, name, category, is_blocked")
        .eq("status_set_id", general.status_set_id).order("position"),
    );
    assert(
      "property default set is To do / In progress / Blocked / Done",
      defaultSet.map((s) => s.name).join(",") === "To do,In progress,Blocked,Done",
      defaultSet.map((s) => s.name).join(","),
    );
    const open = defaultSet.find((s) => s.category === "open");
    const closed = defaultSet.find((s) => s.category === "closed");
    const blocked = defaultSet.find((s) => s.is_blocked);

    // ── Legacy insert (what mobile / runners / seeds do) ───────────────────
    const task = await one(
      service.from("tasks").insert({
        property_id: pid, title: "LISTSMOKE legacy insert", status: "blocked",
      }).select("id, list_id, status_id, status, space_id, completed_at").single(),
    );
    created.taskIds.push(task.id);
    assert("no list given → General", task.list_id === general.id);
    assert("legacy 'blocked' → the blocked status", task.status_id === blocked.id);
    assert("projection stays 'blocked'", task.status === "blocked");
    assert("not completed", task.completed_at === null);

    // ── Legacy done write stamps completed_at ──────────────────────────────
    let t = await one(
      service.from("tasks").update({ status: "done", overdue_notified_at: new Date().toISOString() })
        .eq("id", task.id).select("status_id, status, completed_at, overdue_notified_at").single(),
    );
    assert("legacy 'done' → closed status", t.status_id === closed.id);
    assert("completed_at stamped", t.completed_at !== null);

    // ── status_id-only write reopens + resets the overdue marker ───────────
    t = await one(
      service.from("tasks").update({ status_id: open.id })
        .eq("id", task.id).select("status, completed_at, overdue_notified_at").single(),
    );
    assert("status_id write projects to 'todo'", t.status === "todo");
    assert("completed_at cleared on reopen", t.completed_at === null);
    assert(
      "overdue_notified_at reset on a status_id-only write (trigger order)",
      t.overdue_notified_at === null,
    );

    // ── Space sync: move into a team's default list ────────────────────────
    const space = await one(
      service.from("spaces").insert({ property_id: pid, name: "LISTSMOKE team" })
        .select("id").single(),
    );
    created.spaceIds.push(space.id);
    const teamList = await one(
      service.from("lists").select("id, status_set_id").eq("space_id", space.id)
        .eq("is_default", true).single(),
    );
    assert("new space got a default 'Tasks' list by trigger", !!teamList?.id);
    assert("it inherits the property default set", teamList.status_set_id === general.status_set_id);

    t = await one(
      service.from("tasks").update({ list_id: teamList.id })
        .eq("id", task.id).select("space_id, status_id").single(),
    );
    assert("list move syncs space_id to the list's team", t.space_id === space.id);
    assert("same set → status row unchanged", t.status_id === open.id);

    // ── Space change re-homes to that team's default list ──────────────────
    t = await one(
      service.from("tasks").update({ space_id: null })
        .eq("id", task.id).select("list_id, space_id").single(),
    );
    assert("space_id → null re-homes to General", t.list_id === general.id);

    // ── A 21-status custom pipeline + category remap on list move ──────────
    const set = await one(
      service.from("status_sets").insert({ property_id: pid, name: "LISTSMOKE Maintenance" })
        .select("id").single(),
    );
    created.setIds.push(set.id);
    const names = [
      ["requests", "open", false], ["preparation", "active", false], ["quoting", "active", false],
      ["awaiting payment", "active", true], ["in progress", "active", false],
      ["ready for review", "done", false], ["completed", "closed", false],
    ];
    const rows = await one(
      service.from("statuses").insert(
        names.map(([name, category, is_blocked], i) => ({
          status_set_id: set.id, property_id: pid, name, category, is_blocked, position: (i + 1) * 1024,
        })),
      ).select("id, name"),
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.id]));
    const maint = await one(
      service.from("lists").insert({
        property_id: pid, space_id: space.id, name: "LISTSMOKE Maintenance",
        status_set_id: set.id, inherits_statuses: false,
      }).select("id").single(),
    );
    created.listIds.push(maint.id);

    // Task is 'todo' (open) in General → move into the pipeline.
    t = await one(
      service.from("tasks").update({ list_id: maint.id })
        .eq("id", task.id).select("status_id, status, space_id").single(),
    );
    assert("open → the pipeline's open status (requests)", t.status_id === byName["requests"]);
    assert("space synced to the pipeline list's team", t.space_id === space.id);

    t = await one(
      service.from("tasks").update({ status: "blocked" })
        .eq("id", task.id).select("status_id, status").single(),
    );
    assert("legacy 'blocked' → first blocked active (awaiting payment)", t.status_id === byName["awaiting payment"]);

    t = await one(
      service.from("tasks").update({ status_id: byName["ready for review"] })
        .eq("id", task.id).select("status, completed_at").single(),
    );
    assert("a 'done'-category status projects to 'done'", t.status === "done");
    assert("…and stamps completed_at", t.completed_at !== null);

    // Back to General: done → closed (Done).
    t = await one(
      service.from("tasks").update({ list_id: general.id })
        .eq("id", task.id).select("status_id, status, completed_at").single(),
    );
    assert("done-category remaps to the default set's closed status", t.status_id === closed.id);
    assert("still completed after the move", t.completed_at !== null);

    // A stale status id from another set is remapped, not rejected.
    t = await one(
      service.from("tasks").update({ status_id: byName["quoting"] })
        .eq("id", task.id).select("status_id, status").single(),
    );
    assert("foreign status id → remapped by category (In progress)", t.status_id === defaultSet.find((s) => s.category === "active" && !s.is_blocked).id);

    // ── Side channels ──────────────────────────────────────────────────────
    const acts = await one(
      service.from("activity_log").select("verb, detail").eq("entity_id", task.id).order("created_at"),
    );
    const verbs = acts.map((a) => a.verb);
    assert("activity: completed logged", verbs.includes("completed"));
    assert("activity: reopened logged", verbs.includes("reopened"));
    assert("activity: list_changed logged", verbs.includes("list_changed"));
    assert(
      "activity: status rows carry names",
      acts.some((a) => a.verb === "status_changed" && a.detail?.to_name),
    );
    const evs = await one(
      service.from("workflow_events").select("event_type, payload").eq("entity_id", task.id),
    );
    assert(
      "workflow event: status_changed carries to_category + legacy to",
      evs.some((e) => e.event_type === "task.status_changed" && e.payload.to_category && e.payload.to),
    );
    assert("workflow event: task.moved_to_list", evs.some((e) => e.event_type === "task.moved_to_list"));

    // ── Guards ─────────────────────────────────────────────────────────────
    const { error: delErr } = await service.from("statuses").delete().eq("id", byName["requests"]);
    assert("cannot delete a set's only open status", !!delErr, delErr?.message);
  } finally {
    for (const id of created.taskIds) await service.from("tasks").delete().eq("id", id);
    for (const id of created.listIds) await service.from("lists").delete().eq("id", id);
    for (const id of created.spaceIds) await service.from("spaces").delete().eq("id", id);
    for (const id of created.setIds) await service.from("status_sets").delete().eq("id", id);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
