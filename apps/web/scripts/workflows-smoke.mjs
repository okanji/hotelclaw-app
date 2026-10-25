// Workflows section smoke — drives the REAL cookie-authed workflow routes over
// HTTP against the dev server, the way the list page and the builder do:
//
//   create (manual.run, off) → list shows trigger + steps + created_by →
//   Run now refused while off (409) → turn on → Run now → run lands and
//   succeeds → it's in the property run log → Duplicate (copy starts off) →
//   Delete (archived, gone from the list).
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/workflows-smoke.mjs
//
// The principal is an EPHEMERAL auth user with a temporary manager membership
// (verify-tenancy-rls.mjs pattern); everything it creates is hard-deleted in
// the finally.

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PROPERTY_SLUG = process.env.SMOKE_PROPERTY_SLUG ?? "watamu-villa";

function assert(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? `  — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
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
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error: vErr } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (vErr) throw vErr;
  return data.session;
}

async function main() {
  const { data: property } = await service
    .from("properties").select("id").eq("slug", PROPERTY_SLUG).single();
  const pid = property.id;

  const email = `wf-smoke-${Date.now().toString(36)}@villa.dev`;
  const { data: created, error: cErr } = await service.auth.admin.createUser({
    email, email_confirm: true,
  });
  if (cErr) throw cErr;
  const userId = created.user.id;
  const workflowIds = [];

  try {
    await service.from("memberships").insert({ property_id: pid, user_id: userId, role: "manager" });
    const cookie = sessionCookie(await sessionFor(email));
    const api = async (path, init = {}) => {
      const res = await fetch(`${BASE}/api/properties/${pid}/workflows${path}`, {
        ...init,
        headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    };

    const spec = {
      workflow_spec_version: 1,
      name: "WFSMOKE notify me",
      trigger: { event_type: "manual.run" },
      entry_step_id: "notify",
      steps: {
        notify: {
          id: "notify",
          type: "action.notify.user",
          config: { user_id: userId, title: "WFSMOKE ran" },
        },
      },
    };

    // ── create ────────────────────────────────────────────────────────────
    const c = await api("", {
      method: "POST",
      body: JSON.stringify({ name: "WFSMOKE notify me", spec, enabled: false }),
    });
    assert("create workflow", c.status === 200 && c.body.id, JSON.stringify(c.body));
    const wid = c.body.id;
    workflowIds.push(wid);

    // ── list row carries what the UI renders ───────────────────────────────
    const l = await api("");
    const row = l.body.workflows?.find((w) => w.id === wid);
    assert("list includes it", !!row);
    assert("list row: trigger", row?.trigger_event_type === "manual.run");
    assert("list row: step types", row?.step_types?.includes("action.notify.user"));
    assert("list row: created_by (Mine filter)", row?.created_by === userId);

    // ── Run now is gated on enabled ───────────────────────────────────────
    const r0 = await api(`/${wid}/run`, { method: "POST", body: JSON.stringify({ runNow: true }) });
    assert("run now refused while off", r0.status === 409, `${r0.status} ${JSON.stringify(r0.body)}`);

    const on = await api(`/${wid}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    assert("turn on", on.status === 200, JSON.stringify(on.body));

    const r1 = await api(`/${wid}/run`, { method: "POST", body: JSON.stringify({ runNow: true }) });
    assert("run now returns a run id", r1.status === 200 && r1.body.runId, JSON.stringify(r1.body));

    let run = null;
    for (let i = 0; i < 20 && r1.body.runId; i++) {
      const { data } = await service
        .from("workflow_runs").select("status, error, trigger_kind, triggered_by_user_id")
        .eq("id", r1.body.runId).maybeSingle();
      run = data;
      if (run && !["queued", "running"].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert("run succeeded", run?.status === "succeeded", JSON.stringify(run));
    assert("run attributed to the presser", run?.triggered_by_user_id === userId);
    const { data: notes } = await service
      .from("notifications").select("id").eq("user_id", userId);
    assert("the step's side effect landed (notification row)", (notes ?? []).length === 1);

    const all = await api("/runs");
    assert("run in property run log", all.body.runs?.some((x) => x.id === r1.body.runId));

    // Event-triggered workflows can't be run on demand.
    const ev = await api("", {
      method: "POST",
      body: JSON.stringify({
        name: "WFSMOKE event",
        spec: { ...spec, trigger: { event_type: "task.created" } },
        enabled: true,
      }),
    });
    workflowIds.push(ev.body.id);
    const r2 = await api(`/${ev.body.id}/run`, { method: "POST", body: JSON.stringify({ runNow: true }) });
    assert("run now refused for event triggers", r2.status === 400, `${r2.status}`);

    // ── duplicate (detail GET + create, as the row menu does) ──────────────
    const d = await api(`/${wid}`);
    const dup = await api("", {
      method: "POST",
      body: JSON.stringify({
        name: `${d.body.workflow.name} (copy)`,
        spec: d.body.spec,
        enabled: false,
      }),
    });
    assert("duplicate", dup.status === 200 && dup.body.id, JSON.stringify(dup.body));
    workflowIds.push(dup.body.id);
    const l2 = await api("");
    const copy = l2.body.workflows?.find((w) => w.id === dup.body.id);
    assert("copy starts off with the same trigger", copy?.enabled === false && copy?.trigger_event_type === "manual.run");

    // ── delete = archive ──────────────────────────────────────────────────
    const del = await api(`/${wid}`, { method: "DELETE" });
    assert("delete", del.status === 200);
    const l3 = await api("");
    assert("deleted workflow leaves the list", !l3.body.workflows?.some((w) => w.id === wid));
  } finally {
    for (const id of workflowIds.filter(Boolean)) {
      await service.from("workflow_step_runs").delete().in(
        "run_id",
        ((await service.from("workflow_runs").select("id").eq("workflow_id", id)).data ?? []).map((r) => r.id),
      );
      await service.from("workflow_runs").delete().eq("workflow_id", id);
      await service.from("workflows").update({ current_version_id: null }).eq("id", id);
      await service.from("workflow_versions").delete().eq("workflow_id", id);
      await service.from("workflows").delete().eq("id", id);
    }
    await service.from("notifications").delete().eq("user_id", userId);
    await service.from("memberships").delete().eq("user_id", userId);
    await service.auth.admin.deleteUser(userId);
  }
  console.log(process.exitCode ? "WORKFLOWS SMOKE FAILED" : "Workflows smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
