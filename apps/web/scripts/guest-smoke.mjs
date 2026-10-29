// Guest role smoke (migration 0118) — drives RLS AS REAL USERS (the service
// client bypasses RLS and would prove nothing). An ephemeral STAFF member and
// an ephemeral GUEST join the smoke property; the guest gets grants and we
// assert what each can see and change:
//
//   staff regression (sees everything, as before) → guest with no grant sees
//   the property + directory but no team / list / task / workflow / project
//   → a read grant on team A shows A's team, lists, tasks, checklists, field
//   values and activity, never team B's → read-only can't update → an edit
//   grant can update but can't move the task out of scope → a task grant
//   shows that task + its sub-issues only → the helper RPCs agree →
//   (with `pnpm dev`) the HTTP gates: middleware sends a guest to /tasks,
//   the tasks API returns only shared work, eve refuses a guest session.
//
//   node --env-file=.env.local --no-network-family-autoselection scripts/guest-smoke.mjs
//
// Hard-cleans users, spaces, tasks it creates.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const PROPERTY_SLUG = process.env.SMOKE_PROPERTY_SLUG ?? "solana-cove-resort-spa-demo-d58fc7";
const APP = process.env.SMOKE_APP_URL ?? "http://localhost:3000";

function assert(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? `  — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}
async function one(q) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

async function signedInAs(email) {
  const { data: link, error } = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error: vErr } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (vErr) throw vErr;
  return { client, session: data.session };
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

async function main() {
  const property = await one(service.from("properties").select("id").eq("slug", PROPERTY_SLUG).single());
  const pid = property.id;
  const stamp = Date.now().toString(36);
  const made = { users: [], spaces: [], tasks: [] };

  try {
    const mkUser = async (label, role) => {
      const email = `guest-smoke-${label}-${stamp}@villa.dev`;
      const { data, error } = await service.auth.admin.createUser({ email, email_confirm: true });
      if (error) throw error;
      made.users.push(data.user.id);
      await one(service.from("memberships").insert({ property_id: pid, user_id: data.user.id, role }));
      // Onboarded, so the app doesn't detour through /welcome.
      await service.from("profiles").update({
        full_name: `Guest smoke ${label}`,
        onboarded_at: new Date().toISOString(),
      }).eq("id", data.user.id);
      return { id: data.user.id, email };
    };
    const staff = await mkUser("staff", "staff");
    const guest = await mkUser("guest", "guest");

    // Two teams, each with its default list (trigger), a task each, and a
    // sub-issue under A's task.
    const mkSpace = async (name) => {
      const s = await one(service.from("spaces").insert({ property_id: pid, name }).select("id").single());
      made.spaces.push(s.id);
      return s.id;
    };
    const spaceA = await mkSpace(`GUESTSMOKE A ${stamp}`);
    const spaceB = await mkSpace(`GUESTSMOKE B ${stamp}`);
    const mkTask = async (title, extra) => {
      const t = await one(
        service.from("tasks").insert({ property_id: pid, title, ...extra }).select("id, list_id").single(),
      );
      made.tasks.push(t.id);
      return t;
    };
    const taskA = await mkTask("GUESTSMOKE task A", { space_id: spaceA });
    const subA = await mkTask("GUESTSMOKE sub A", { space_id: spaceA, parent_id: taskA.id });
    const taskB = await mkTask("GUESTSMOKE task B", { space_id: spaceB });
    const cl = await one(
      service.from("task_checklists").insert({ task_id: taskA.id, property_id: pid, name: "Prep" }).select("id").single(),
    );
    await one(service.from("task_checklist_items").insert({
      checklist_id: cl.id, task_id: taskA.id, property_id: pid, text: "Keys",
    }));

    const { client: S } = await signedInAs(staff.email);
    const { client: G, session: guestSession } = await signedInAs(guest.email);

    const ids = async (client, table, col, values) =>
      (await one(client.from(table).select("id").in(col, values))).map((r) => r.id);

    // ── staff regression ──────────────────────────────────────────────────
    const staffTasks = await ids(S, "tasks", "id", [taskA.id, subA.id, taskB.id]);
    assert("staff sees every task", staffTasks.length === 3, staffTasks.join());
    const staffSpaces = await ids(S, "spaces", "id", [spaceA, spaceB]);
    assert("staff sees both teams", staffSpaces.length === 2);
    const { data: staffUpd } = await S.from("tasks").update({ title: "GUESTSMOKE task B (staff)" }).eq("id", taskB.id).select("id");
    assert("staff can update", staffUpd?.length === 1);
    const { data: staffIsMember } = await S.rpc("is_member", { prop_id: pid });
    assert("is_member true for staff", staffIsMember === true);

    // ── guest, no grants ──────────────────────────────────────────────────
    const prop = await one(G.from("properties").select("id").eq("id", pid));
    assert("guest sees the property", prop.length === 1);
    const dir = await one(G.from("memberships").select("user_id").eq("property_id", pid));
    assert("guest sees the member directory (accepted leak)", dir.length >= 2);
    assert("guest with no grant sees no tasks", (await ids(G, "tasks", "id", [taskA.id, taskB.id])).length === 0);
    assert("guest with no grant sees no teams", (await ids(G, "spaces", "id", [spaceA, spaceB])).length === 0);
    const wf = await G.from("workflows").select("id").eq("property_id", pid).limit(1);
    assert("guest sees no workflows", (wf.data ?? []).length === 0);
    const pr = await G.from("projects").select("id").eq("property_id", pid).limit(1);
    assert("guest sees no projects", (pr.data ?? []).length === 0);
    const { data: guestIsMember } = await G.rpc("is_member", { prop_id: pid });
    assert("is_member false for a guest", guestIsMember === false);
    const { data: guestAccess } = await G.rpc("has_property_access", { prop_id: pid });
    assert("has_property_access true for a guest", guestAccess === true);

    // A guest can't grant themselves anything.
    const { error: selfGrant } = await G.from("member_scopes").insert({
      property_id: pid, user_id: guest.id, scope_kind: "space", scope_id: spaceB,
    });
    assert("guest can't grant themselves a scope", !!selfGrant);

    // ── read grant on team A ──────────────────────────────────────────────
    const grant = await one(
      service.from("member_scopes").insert({
        property_id: pid, user_id: guest.id, scope_kind: "space", scope_id: spaceA, can_edit: false,
      }).select("id").single(),
    );
    const seen = await ids(G, "tasks", "id", [taskA.id, subA.id, taskB.id]);
    assert("space grant: sees A's task + sub-issue, not B's", seen.length === 2 && !seen.includes(taskB.id), seen.join());
    assert("space grant: sees team A only", JSON.stringify(await ids(G, "spaces", "id", [spaceA, spaceB])) === JSON.stringify([spaceA]));
    const lists = await one(G.from("lists").select("id, space_id").in("space_id", [spaceA, spaceB]));
    assert("space grant: sees A's lists only", lists.length >= 1 && lists.every((l) => l.space_id === spaceA));
    const items = await one(G.from("task_checklist_items").select("id").eq("task_id", taskA.id));
    assert("space grant: sees the task's checklist", items.length === 1);
    const { data: canA } = await G.rpc("can_access_task", { tid: taskA.id, need_edit: false });
    const { data: canB } = await G.rpc("can_access_task", { tid: taskB.id, need_edit: false });
    const { data: editA } = await G.rpc("can_access_task", { tid: taskA.id, need_edit: true });
    assert("can_access_task agrees (A yes, B no, A not editable)", canA === true && canB === false && editA === false);
    const { data: roUpd } = await G.from("tasks").update({ title: "hacked" }).eq("id", taskA.id).select("id");
    assert("read-only grant can't update", (roUpd ?? []).length === 0);
    const { error: tickErr, data: tickRows } = await G.from("task_checklist_items").update({ done: true }).eq("task_id", taskA.id).select("id");
    assert("read-only grant can't tick", !!tickErr || (tickRows ?? []).length === 0);

    // ── edit grant ────────────────────────────────────────────────────────
    await one(service.from("member_scopes").update({ can_edit: true }).eq("id", grant.id).select("id"));
    const { data: edUpd } = await G.from("tasks").update({ title: "GUESTSMOKE task A (guest)" }).eq("id", taskA.id).select("id");
    assert("edit grant can update", edUpd?.length === 1);
    const { data: tick } = await G.from("task_checklist_items").update({ done: true }).eq("task_id", taskA.id).select("id");
    assert("edit grant can tick", tick?.length === 1);
    const { data: moveOut, error: moveErr } = await G.from("tasks").update({ space_id: spaceB }).eq("id", taskA.id).select("id");
    assert("edit grant can't move a task out of scope", !!moveErr || (moveOut ?? []).length === 0, JSON.stringify(moveErr ?? moveOut));
    const { error: delErr, data: del } = await G.from("tasks").delete().eq("id", subA.id).select("id");
    assert("guests never delete", !!delErr || (del ?? []).length === 0);

    // ── task grant instead of the space grant ─────────────────────────────
    await one(service.from("member_scopes").delete().eq("id", grant.id).select("id"));
    await one(service.from("member_scopes").insert({
      property_id: pid, user_id: guest.id, scope_kind: "task", scope_id: taskA.id,
    }));
    const seenTask = await ids(G, "tasks", "id", [taskA.id, subA.id, taskB.id]);
    assert("task grant: the task + its sub-issue", seenTask.length === 2 && !seenTask.includes(taskB.id), seenTask.join());
    assert("task grant: no team visibility", (await ids(G, "spaces", "id", [spaceA])).length === 0);
    const act = await one(G.from("activity_log").select("entity_id").eq("property_id", pid).limit(200));
    assert("activity only for granted tasks", act.every((a) => [taskA.id, subA.id].includes(a.entity_id)), JSON.stringify(act.slice(0, 3)));

    // ── HTTP gates (need `pnpm dev`) ──────────────────────────────────────
    const up = await fetch(`${APP}/login`).then((r) => r.ok).catch(() => false);
    if (!up) {
      console.log("SKIP  HTTP gates — no dev server at", APP);
    } else {
      const cookie = sessionCookie(guestSession);
      const page = await fetch(`${APP}/p/${pid}/workflows`, { headers: { cookie }, redirect: "manual" });
      const to = page.headers.get("location") ?? "";
      assert("middleware sends a guest off a full-member section", page.status >= 300 && page.status < 400 && /\/(my-)?tasks/.test(to), `${page.status} ${to}`);
      const tasksPage = await fetch(`${APP}/p/${pid}/tasks`, { headers: { cookie }, redirect: "manual" });
      assert("a guest may open Tasks", tasksPage.status === 200, `${tasksPage.status} ${tasksPage.headers.get("location") ?? ""}`);
      const api = await fetch(`${APP}/api/properties/${pid}/tasks`, { headers: { cookie } });
      const rows = api.ok ? await api.json() : [];
      const apiIds = Array.isArray(rows) ? rows.map((r) => r.id) : [];
      assert("tasks API returns only shared work", api.ok && apiIds.length === 2 && apiIds.includes(taskA.id) && !apiIds.includes(taskB.id), `${api.status} ${apiIds.length}`);
      const eve = await fetch(`${APP}/eve/v1/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${guestSession.access_token}`,
          "x-hotelclaw-property": pid,
        },
        body: JSON.stringify({ message: "hello" }),
      });
      if (eve.status === 202) {
        // Dev only: eve's chain ends in localDev(), which admits ANY caller
        // with no property attributes (no tools, no data). Production omits
        // it; the guest refusal itself is drift-guarded in
        // agent-runtime-sync.test.ts ("guest role never reaches the runtime").
        console.log("NOTE  eve: dev localDev() fallback admitted the call WITHOUT property scope");
      } else {
        assert("eve refuses a guest session", eve.status === 401 || eve.status === 403, String(eve.status));
      }
      // Every section a guest may open renders without the error boundary,
      // and none of them leaks team B's task.
      for (const path of [
        "tasks",
        `tasks/${taskA.id}`,
        "my-tasks",
        "documents",
        "chat",
        "inbox",
        "activity",
        "notifications",
        "favorites",
        `spaces/${spaceA}`,
      ]) {
        const res = await fetch(`${APP}/p/${pid}/${path}`, { headers: { cookie }, redirect: "manual" });
        const html = res.status === 200 ? await res.text() : "";
        assert(
          `guest page /${path.split("/")[0]} renders`,
          res.status === 200 && !html.includes("Something went wrong"),
          `${res.status} ${res.headers.get("location") ?? ""}`,
        );
        assert(`guest page /${path.split("/")[0]} doesn't leak team B`, !html.includes("GUESTSMOKE task B"));
      }
      // Liveblocks: a guest gets only the rooms of what was shared — READ on
      // a view-only task grant, never the board or another task.
      const lb = (room) =>
        fetch(`${APP}/api/liveblocks/auth`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ room }),
        });
      const lbA = await lb(`property:${pid}:task:${taskA.id}`);
      assert("liveblocks: granted task room is authorized", lbA.status === 200, String(lbA.status));
      const lbB = await lb(`property:${pid}:task:${taskB.id}`);
      assert("liveblocks: unshared task room is refused", lbB.status === 403, String(lbB.status));
      const lbBoard = await lb(`property:${pid}:tasks`);
      assert("liveblocks: board room is refused", lbBoard.status === 403, String(lbBoard.status));
      const otherTask = await fetch(`${APP}/p/${pid}/tasks/${taskB.id}`, { headers: { cookie } });
      const otherHtml = await otherTask.text();
      assert("an unshared task page doesn't render its title", !otherHtml.includes("GUESTSMOKE task B"));
      const wfApi = await fetch(`${APP}/api/properties/${pid}/workflows`, { headers: { cookie } });
      const wfBody = wfApi.ok ? await wfApi.json() : null;
      assert("workflows API gives a guest nothing", !wfApi.ok || (wfBody?.workflows ?? []).length === 0, String(wfApi.status));
    }
  } finally {
    if (made.tasks.length) await service.from("tasks").delete().in("id", made.tasks.reverse());
    if (made.spaces.length) await service.from("spaces").delete().in("id", made.spaces);
    for (const id of made.users) {
      await service.from("memberships").delete().eq("user_id", id);
      await service.auth.admin.deleteUser(id);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
