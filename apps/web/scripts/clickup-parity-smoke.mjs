// ClickUp parity smoke (migrations 0115+) — drives the DB contracts the web,
// mobile, workflow and agent write paths rely on, with the SERVICE client.
//
//   assignees (0115): legacy insert seeds the set silently → adding a person
//   logs + emits once and keeps the primary → a legacy assignee_id write
//   replaces the primary and keeps the rest → deleting the primary promotes
//   the next → assignee_id = null clears the set with one task.unassigned per
//   person → a task delete cascades without logging.
//
//   fields (0116): progress / files refuse direct writes → an attachment in a
//   slot derives the files value (+ event label) → the shared writer over
//   HTTP (/api/internal/tasks/:id/fields, needs `pnpm dev`) coerces currency,
//   people, relation keys, urls and refuses bad values.
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/clickup-parity-smoke.mjs [assignees|fields|checklists]
//
// Hard-cleans everything it creates.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const PROPERTY_SLUG = process.env.SMOKE_PROPERTY_SLUG ?? "solana-cove-resort-spa-demo-d58fc7";
const only = process.argv[2] ?? null;

function assert(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? `  — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function one(q) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

const created = { taskIds: [], fieldIds: [] };
const APP = process.env.SMOKE_APP_URL ?? "http://localhost:3000";

async function setOf(taskId) {
  const rows = await one(
    service.from("task_assignees").select("user_id, position, created_at")
      .eq("task_id", taskId).order("position").order("created_at"),
  );
  return rows.map((r) => r.user_id);
}
async function primaryOf(taskId) {
  const t = await one(service.from("tasks").select("assignee_id").eq("id", taskId).single());
  return t.assignee_id;
}
async function count(table, filters) {
  let q = service.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

async function assignees(pid) {
  console.log("\n— assignees (0115)");
  const members = await one(
    service.from("memberships").select("user_id").eq("property_id", pid)
      .order("created_at").limit(3),
  );
  if (members.length < 3) {
    console.log("SKIP  need 3 members on the smoke property");
    return;
  }
  const [a, b, c] = members.map((m) => m.user_id);

  const task = await one(
    service.from("tasks").insert({ property_id: pid, title: "PARITYSMOKE assignees", assignee_id: a })
      .select("id").single(),
  );
  created.taskIds.push(task.id);
  const tid = task.id;
  const acts = (verb) => count("activity_log", { entity_id: tid, verb });
  const evs = (type) => count("workflow_events", { entity_id: tid, event_type: type });

  assert("insert seeds the set with the primary", (await setOf(tid)).join() === a);
  assert("the seed is silent (no assigned row, no task.assigned)",
    (await acts("assigned")) === 0 && (await evs("task.assigned")) === 0);

  await one(service.from("task_assignees").insert({ task_id: tid, user_id: b, property_id: pid, position: 1 }));
  assert("adding b keeps a primary", (await primaryOf(tid)) === a);
  assert("adding b logs one assigned row", (await acts("assigned")) === 1);
  assert("adding b emits one task.assigned", (await evs("task.assigned")) === 1);

  await one(service.from("tasks").update({ assignee_id: c }).eq("id", tid));
  assert("legacy write c replaces a, keeps b", (await setOf(tid)).join() === [c, b].join(),
    (await setOf(tid)).join());
  assert("legacy write c makes c primary", (await primaryOf(tid)) === c);
  assert("legacy replace logs assigned c + unassigned a",
    (await acts("assigned")) === 2 && (await acts("unassigned")) === 1);

  await one(service.from("tasks").update({ assignee_id: b }).eq("id", tid));
  assert("legacy write to an existing member reorders, no duplicate",
    (await setOf(tid)).join() === b, (await setOf(tid)).join());

  await one(service.from("task_assignees").insert({ task_id: tid, user_id: a, property_id: pid, position: 5 }));
  await one(service.from("task_assignees").delete().eq("task_id", tid).eq("user_id", b));
  assert("deleting the primary promotes the next", (await primaryOf(tid)) === a);

  await one(service.from("task_assignees").insert({ task_id: tid, user_id: c, property_id: pid, position: 6 }));
  const before = await evs("task.unassigned");
  await one(service.from("tasks").update({ assignee_id: null }).eq("id", tid));
  assert("assignee_id = null clears the set", (await setOf(tid)).length === 0);
  assert("clearing emits one task.unassigned per person",
    (await evs("task.unassigned")) - before === 2);

  await one(service.from("task_assignees").insert({ task_id: tid, user_id: a, property_id: pid }));
  assert("set-only insert on an empty task sets the primary", (await primaryOf(tid)) === a);
  const unBefore = await acts("unassigned");
  await one(service.from("tasks").delete().eq("id", tid));
  created.taskIds = created.taskIds.filter((x) => x !== tid);
  assert("task delete cascades the set", (await count("task_assignees", { task_id: tid })) === 0);
  assert("cascade does not log unassigned", (await acts("unassigned")) === unBefore);
}

async function fields(pid) {
  console.log("\n— custom field types (0116)");
  const members = await one(
    service.from("memberships").select("user_id").eq("property_id", pid).order("created_at").limit(2),
  );
  const profiles = await one(
    service.from("profiles").select("id, full_name").in("id", members.map((m) => m.user_id)),
  );
  const person = profiles.find((p) => p.full_name) ?? profiles[0];
  const mk = async (name, type, config = {}) => {
    const row = await one(
      service.from("custom_fields")
        .insert({ property_id: pid, name: `PARITYSMOKE ${name}`, type, config })
        .select("id, name").single(),
    );
    created.fieldIds.push(row.id);
    return row;
  };
  const cost = await mk("Cost", "currency", { code: "KES", precision: 0 });
  const requester = await mk("Requester", "people", { multiple: true });
  const quote = await mk("Quote", "files");
  const blocks = await mk("Blocks", "relation");
  const prog = await mk("Progress", "progress");
  const site = await mk("Site", "url");

  const task = await one(
    service.from("tasks").insert({ property_id: pid, title: "PARITYSMOKE fields" }).select("id, number").single(),
  );
  const other = await one(
    service.from("tasks").insert({ property_id: pid, title: "PARITYSMOKE related" }).select("id, number").single(),
  );
  created.taskIds.push(task.id, other.id);
  const prop = await one(service.from("properties").select("task_prefix").eq("id", pid).single());

  // Computed types refuse direct writes.
  const { error: progErr } = await service.from("task_field_values")
    .insert({ task_id: task.id, field_id: prog.id, property_id: pid, value: 3 });
  assert("progress can't be written", !!progErr);
  const { error: filesErr } = await service.from("task_field_values")
    .insert({ task_id: task.id, field_id: quote.id, property_id: pid, value: ["x"] });
  assert("files can't be written directly", !!filesErr);

  // files ← task_attachments.
  const att = await one(
    service.from("task_attachments").insert({
      task_id: task.id, file_name: "quote.pdf", storage_path: `${pid}/${task.id}/smoke-quote.pdf`, field_id: quote.id,
    }).select("id").single(),
  );
  const fv = await service.from("task_field_values").select("value").eq("task_id", task.id).eq("field_id", quote.id).maybeSingle();
  assert("attaching to a slot derives the files value", JSON.stringify(fv.data?.value) === JSON.stringify([att.id]));
  const ev = await one(
    service.from("workflow_events").select("payload").eq("entity_id", task.id).eq("event_type", "task.field_changed")
      .order("received_at", { ascending: false }).limit(1),
  );
  assert("files change event names the file", ev[0]?.payload?.to_label === "quote.pdf", ev[0]?.payload?.to_label);
  await one(service.from("task_attachments").delete().eq("id", att.id));
  const gone = await service.from("task_field_values").select("value").eq("task_id", task.id).eq("field_id", quote.id).maybeSingle();
  assert("removing the last file clears the value", gone.data === null);

  // The shared writer over HTTP (the AI tool's path).
  const post = async (field, value) => {
    const res = await fetch(`${APP}/api/internal/tasks/${task.id}/fields`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ propertyId: pid, field, value }),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }));
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  let r = await post(cost.name, "1,250.6");
  assert("currency coerces + rounds to the field's precision", r.body?.value === 1251, JSON.stringify(r));
  const costEv = await one(
    service.from("workflow_events").select("payload").eq("entity_id", task.id).eq("event_type", "task.field_changed")
      .order("received_at", { ascending: false }).limit(1),
  );
  assert("currency event label is formatted", costEv[0]?.payload?.to_label === "KES 1,251", costEv[0]?.payload?.to_label);
  r = await post(requester.name, person.full_name ?? person.id);
  assert("people resolves a name to the member id", JSON.stringify(r.body?.value) === JSON.stringify([person.id]), JSON.stringify(r));
  const pplEv = await one(
    service.from("workflow_events").select("payload").eq("entity_id", task.id).eq("event_type", "task.field_changed")
      .order("received_at", { ascending: false }).limit(1),
  );
  assert("people event label carries the name", !!person.full_name ? pplEv[0]?.payload?.to_label === person.full_name : true, pplEv[0]?.payload?.to_label);
  const key = `${prop.task_prefix}-${other.number}`;
  r = await post(blocks.name, key);
  assert("relation resolves a task key", JSON.stringify(r.body?.value) === JSON.stringify([other.id]), JSON.stringify(r));
  r = await post(site.name, "temple-point.example/menu");
  assert("url gets a scheme", r.body?.value === "https://temple-point.example/menu", JSON.stringify(r));
  r = await post(prog.name, "50");
  assert("progress write is refused with a reason", r.status === 422 && /computed/.test(r.body?.error ?? ""), JSON.stringify(r));
  r = await post(cost.name, "lots");
  assert("bad amount is refused with a reason", r.status === 422, JSON.stringify(r));
  r = await post(cost.name, "");
  const cleared = await service.from("task_field_values").select("value").eq("task_id", task.id).eq("field_id", cost.id).maybeSingle();
  assert("empty clears the field", r.status === 200 && cleared.data === null, JSON.stringify(r));
}

// @supabase/ssr's cookie: "base64-" + base64url(session JSON), chunked.
function sessionCookie(session) {
  const ref = new URL(url).hostname.split(".")[0];
  const name = `sb-${ref}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const CHUNK = 3180;
  if (value.length <= CHUNK) return `${name}=${value}`;
  const parts = [];
  for (let i = 0; i * CHUNK < value.length; i++) {
    parts.push(`${name}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
  return parts.join("; ");
}

async function sessionFor(email) {
  const { data: link, error } = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error: vErr } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (vErr) throw vErr;
  return data.session;
}

/**
 * The create-task step's `fields` (forms → fields' landing point), run for
 * real through "Run now": typed values go through the shared writer, a file
 * list is COPIED from form-uploads into a files slot.
 */
async function fieldsWorkflow(pid) {
  console.log("\n— create-task step writes custom fields (0116)");
  const email = `parity-smoke-${Date.now().toString(36)}@villa.dev`;
  const { data: made, error: cErr } = await service.auth.admin.createUser({ email, email_confirm: true });
  if (cErr) throw cErr;
  const userId = made.user.id;
  let workflowId = null;
  const uploadPath = `${pid}/smoke/${Date.now()}-quote.txt`;
  try {
    await one(service.from("memberships").insert({ property_id: pid, user_id: userId, role: "manager" }));
    const cookie = sessionCookie(await sessionFor(email));
    const mk = async (name, type, config = {}) => {
      const row = await one(
        service.from("custom_fields")
          .insert({ property_id: pid, name: `PARITYSMOKE ${name}`, type, config })
          .select("id, name").single(),
      );
      created.fieldIds.push(row.id);
      return row;
    };
    const cost = await mk("WF Cost", "currency", { code: "USD", precision: 2 });
    const quote = await mk("WF Quote", "files");
    const up = await service.storage.from("form-uploads")
      .upload(uploadPath, new Blob(["smoke quote"], { type: "text/plain" }), { contentType: "text/plain" });
    assert("seed a form upload", !up.error, up.error?.message);

    const spec = {
      workflow_spec_version: 1,
      name: "PARITYSMOKE fields",
      trigger: { event_type: "manual.run" },
      entry_step_id: "make",
      steps: {
        make: {
          id: "make",
          type: "action.task.create",
          config: {
            title: "PARITYSMOKE from workflow",
            fields: {
              [cost.id]: "1,999.999",
              [quote.name]: [{ name: "quote.txt", path: uploadPath, url: "https://invalid.example/x", type: "text/plain" }],
              "PARITYSMOKE no such field": "x",
            },
          },
        },
      },
    };
    const api = async (path, init = {}) => {
      const res = await fetch(`${APP}/api/properties/${pid}/workflows${path}`, {
        ...init,
        headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const c = await api("", { method: "POST", body: JSON.stringify({ name: spec.name, spec, enabled: true }) });
    assert("save the workflow (fields in a create step validate)", c.status === 200 && c.body.id, JSON.stringify(c.body));
    workflowId = c.body.id;
    const run = await api(`/${workflowId}/run`, { method: "POST", body: JSON.stringify({ runNow: true }) });
    assert("run now", run.status === 200, JSON.stringify(run.body));

    const task = await service.from("tasks").select("id").eq("property_id", pid)
      .eq("title", "PARITYSMOKE from workflow").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (task.data) created.taskIds.push(task.data.id);
    assert("the step created the task", !!task.data);
    if (!task.data) return;
    const vals = await one(service.from("task_field_values").select("field_id, value").eq("task_id", task.data.id));
    const byField = Object.fromEntries(vals.map((v) => [v.field_id, v.value]));
    assert("currency written + rounded", byField[cost.id] === 2000, JSON.stringify(byField[cost.id]));
    const atts = await one(service.from("task_attachments").select("id, storage_path, field_id").eq("task_id", task.data.id));
    assert("form file copied into the slot", atts.length === 1 && atts[0].field_id === quote.id, JSON.stringify(atts));
    assert("files value derived from the copy", JSON.stringify(byField[quote.id]) === JSON.stringify(atts.map((a) => a.id)));
    const copied = atts[0]
      ? await service.storage.from("task-attachments").download(atts[0].storage_path)
      : { error: "none" };
    assert("the copied object exists in task-attachments", !copied.error);
    if (atts[0]) await service.storage.from("task-attachments").remove([atts[0].storage_path]);
    const stepRun = await service.from("workflow_step_runs").select("output").eq("step_id", "make")
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    const fe = stepRun.data?.output?.field_errors ?? null;
    assert("an unknown field is reported, not thrown", !!fe && Object.keys(fe).some((k) => /no such field/.test(k)), JSON.stringify(stepRun.data?.output ?? stepRun.error));
  } finally {
    if (workflowId) await service.from("workflows").delete().eq("id", workflowId);
    await service.storage.from("form-uploads").remove([uploadPath]);
    await service.from("memberships").delete().eq("user_id", userId);
    await service.auth.admin.deleteUser(userId);
  }
}

async function checklists(pid) {
  console.log("\n— checklists (0117)");
  const task = await one(
    service.from("tasks").insert({ property_id: pid, title: "PARITYSMOKE checklist" }).select("id").single(),
  );
  created.taskIds.push(task.id);
  const tid = task.id;
  const counters = async () =>
    one(service.from("tasks").select("checklist_total, checklist_done").eq("id", tid).single());
  const acts = (verb) => count("activity_log", { entity_id: tid, verb });
  const evs = () => count("workflow_events", { entity_id: tid, event_type: "task.checklist_completed" });

  const cl = await one(
    service.from("task_checklists").insert({ task_id: tid, property_id: pid, name: "Task Prep" }).select("id").single(),
  );
  assert("adding a checklist logs checklist_added", (await acts("checklist_added")) === 1);
  const rows = await one(
    service.from("task_checklist_items").insert(
      ["Keys", "Radios", "Float"].map((text, i) => ({
        checklist_id: cl.id, task_id: tid, property_id: pid, text, position: (i + 1) * 1024,
      })),
    ).select("id, text"),
  );
  let c = await counters();
  assert("counters count items", c.checklist_total === 3 && c.checklist_done === 0, JSON.stringify(c));
  const child = await one(
    service.from("task_checklist_items").insert({
      checklist_id: cl.id, task_id: tid, property_id: pid, parent_item_id: rows[0].id, text: "Spare set",
    }).select("id").single(),
  );
  const { error: deepErr } = await service.from("task_checklist_items").insert({
    checklist_id: cl.id, task_id: tid, property_id: pid, parent_item_id: child.id, text: "too deep",
  });
  assert("items nest one level only", !!deepErr);

  for (const r of rows) await one(service.from("task_checklist_items").update({ done: true }).eq("id", r.id).select("id"));
  assert("not complete while a sub-item is open", (await evs()) === 0);
  const ticked = await one(
    service.from("task_checklist_items").update({ done: true }).eq("id", child.id).select("done_at").single(),
  );
  assert("ticking stamps done_at", !!ticked.done_at);
  c = await counters();
  assert("counters follow ticks", c.checklist_total === 4 && c.checklist_done === 4, JSON.stringify(c));
  assert("the last tick completes the checklist once (activity)", (await acts("checklist_completed")) === 1);
  assert("…and emits task.checklist_completed once", (await evs()) === 1);
  await one(service.from("task_checklist_items").update({ done: false }).eq("id", child.id).select("id"));
  await one(service.from("task_checklist_items").update({ done: true }).eq("id", child.id).select("id"));
  assert("re-completing emits again (a real second completion)", (await evs()) === 2);

  await one(service.from("task_checklists").delete().eq("id", cl.id).select("id"));
  c = await counters();
  assert("deleting the checklist zeroes the counters", c.checklist_total === 0 && c.checklist_done === 0, JSON.stringify(c));
  assert("…and logs checklist_removed", (await acts("checklist_removed")) === 1);
}

async function checklistWorkflow(pid) {
  console.log("\n— workflow action.task.add_checklist (0117)");
  const email = `parity-cl-${Date.now().toString(36)}@villa.dev`;
  const { data: made, error: cErr } = await service.auth.admin.createUser({ email, email_confirm: true });
  if (cErr) throw cErr;
  const userId = made.user.id;
  let workflowId = null;
  try {
    await one(service.from("memberships").insert({ property_id: pid, user_id: userId, role: "manager" }));
    const cookie = sessionCookie(await sessionFor(email));
    const task = await one(
      service.from("tasks").insert({ property_id: pid, title: "PARITYSMOKE wf checklist" }).select("id").single(),
    );
    created.taskIds.push(task.id);
    const spec = {
      workflow_spec_version: 1,
      name: "PARITYSMOKE checklist",
      trigger: { event_type: "manual.run" },
      entry_step_id: "prep",
      steps: {
        prep: {
          id: "prep",
          type: "action.task.add_checklist",
          config: { task_id: task.id, name: "Task Prep", items: "- [x] Keys\n  - Spare set\nRadios" },
        },
      },
    };
    const api = async (path, init = {}) => {
      const res = await fetch(`${APP}/api/properties/${pid}/workflows${path}`, {
        ...init,
        headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const c = await api("", { method: "POST", body: JSON.stringify({ name: spec.name, spec, enabled: true }) });
    assert("save the add-checklist workflow", c.status === 200 && c.body.id, JSON.stringify(c.body));
    workflowId = c.body.id;
    const run = await api(`/${workflowId}/run`, { method: "POST", body: JSON.stringify({ runNow: true }) });
    assert("run now", run.status === 200, JSON.stringify(run.body));
    const items = await one(
      service.from("task_checklist_items").select("text, done, parent_item_id").eq("task_id", task.id).order("position"),
    );
    const top = items.filter((i) => !i.parent_item_id);
    assert("checklist written with 3 items", items.length === 3, JSON.stringify(items));
    assert("parsed tick + nesting", top.find((i) => i.text === "Keys")?.done === true && items.some((i) => i.parent_item_id && i.text === "Spare set"));
    const run2 = await api(`/${workflowId}/run`, { method: "POST", body: JSON.stringify({ runNow: true }) });
    const lists = await one(service.from("task_checklists").select("id").eq("task_id", task.id));
    assert("a second run appends to the same named checklist", run2.status === 200 && lists.length === 1);
  } finally {
    if (workflowId) await service.from("workflows").delete().eq("id", workflowId);
    await service.from("memberships").delete().eq("user_id", userId);
    await service.auth.admin.deleteUser(userId);
  }
}

async function main() {
  const property = await one(
    service.from("properties").select("id").eq("slug", PROPERTY_SLUG).single(),
  );
  const pid = property.id;
  try {
    if (!only || only === "assignees") await assignees(pid);
    if (!only || only === "fields") await fields(pid);
    if (!only || only === "fields") await fieldsWorkflow(pid);
    if (!only || only === "checklists") await checklists(pid);
    if (!only || only === "checklists") await checklistWorkflow(pid);
  } finally {
    if (created.taskIds.length) {
      await service.from("tasks").delete().in("id", created.taskIds);
    }
    if (created.fieldIds.length) {
      await service.from("custom_fields").delete().in("id", created.fieldIds);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
