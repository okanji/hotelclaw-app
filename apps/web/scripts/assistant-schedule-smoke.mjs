// Project schedules smoke test — proves a schedule is a REAL workflow that
// really fires, end to end, against the running dev server:
//
//   save a schedule → pg_cron job registered (workflow_schedules)
//     → cron event emitted (workflows_emit_cron_event)
//     → dispatcher drains it (/api/workflows/drain)
//     → action.assistant.run creates a conversation in the project
//     → the eve session runs with the PROJECT's persona
//     → disabling the schedule unregisters the pg_cron job
//
//   node --env-file=.env.local --no-network-family-autoselection \
//     scripts/assistant-schedule-smoke.mjs
//
// Why this cannot be a unit test: the failure this suite exists to catch is a
// spec that VALIDATES and still never runs. `TriggerFilter` is `.passthrough()`,
// so a cron under `trigger.filter` type-checks, validates, and renders fine in
// the builder — and reconcileCronSchedule, which reads `trigger.schedule.cron`,
// silently registers nothing. Only asking Postgres "is there a job?" catches it.
//
// Fixtures carry a SCHEDSMOKE marker and are cleaned up, including after a
// failure, so the run is safe to repeat.

import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.env.DEV_ORIGIN ?? "http://127.0.0.1:3000";
const PROPERTY = process.env.ASSISTANT_TEST_PROPERTY ?? "c63d28a6-b8fb-452e-8eee-ebe1e0e4a4fa";
const USER = process.env.ASSISTANT_TEST_USER ?? "33831554-d1a7-4f62-85a5-85952cbc11e4";
const MARKER = "SCHEDSMOKE";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

let failed = false;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `\n      ${extra}`}`);
  if (!cond) failed = true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The spec the Scheduled card emits, mirrored here so the script exercises
 *  the same shape without importing TS. Kept minimal on purpose — the pure
 *  builder is unit-tested; this is about whether the SYSTEM runs it. */
function scheduleSpec(projectId, projectName, cron) {
  return {
    workflow_spec_version: 1,
    name: `${projectName}: ${MARKER} review`,
    trigger: {
      event_type: "schedule.cron",
      schedule: { cron, timezone: "UTC" },
    },
    entry_step_id: "assistant-run",
    steps: {
      "assistant-run": {
        id: "assistant-run",
        type: "action.assistant.run",
        label: `${MARKER} review`,
        config: {
          brief:
            "Reply with exactly one sentence naming the villa's backup generator from this project's memory. No tools.",
          project_id: projectId,
          title: `${MARKER} review`,
          notify: false,
        },
      },
    },
  };
}

async function cleanup(ids = {}) {
  await supabase.from("assistant_chats").delete().like("title", `%${MARKER}%`);
  const { data: workflows } = await supabase
    .from("workflows")
    .select("id")
    .eq("property_id", PROPERTY)
    .like("name", `%${MARKER}%`);
  for (const w of workflows ?? []) {
    await supabase.rpc("workflows_unschedule_cron", { p_workflow_id: w.id });
    await supabase.from("workflow_versions").delete().eq("workflow_id", w.id);
    await supabase.from("workflows").delete().eq("id", w.id);
  }
  await supabase.from("assistant_projects").delete().like("name", `%${MARKER}%`);
  if (ids.projectId) {
    await supabase.from("assistant_projects").delete().eq("id", ids.projectId);
  }
}

async function main() {
  console.log(`Project schedules smoke — ${ORIGIN}\n`);
  await cleanup();

  // ── Fixture: a project with a checkable fact in its memory ───────────────
  const { data: project, error: projectErr } = await supabase
    .from("assistant_projects")
    .insert({
      property_id: PROPERTY,
      user_id: USER,
      name: `${MARKER} Villa`,
      memory: "The backup generator is a Kohler 20kW installed in 2024.",
    })
    .select("id, name")
    .single();
  check("project fixture created", !projectErr, projectErr?.message ?? "");
  if (!project) {
    await cleanup();
    process.exit(1);
  }

  // ── 1. Saving a schedule registers a pg_cron job ─────────────────────────
  console.log("── Saving the schedule");
  const { data: workflow, error: wfErr } = await supabase
    .from("workflows")
    .insert({
      property_id: PROPERTY,
      name: `${project.name}: ${MARKER} review`,
      description: "Schedule smoke fixture.",
      enabled: true,
      created_by: USER,
      updated_by: USER,
    })
    .select("id")
    .single();
  check("workflow row created", !wfErr && Boolean(workflow), wfErr?.message ?? "");
  if (!workflow) {
    await cleanup({ projectId: project.id });
    process.exit(1);
  }

  // Through saveWorkflow itself (the workflows API is cookie-authed, and the
  // save path is precisely what has to run — reconcileCronSchedule lives there).
  const saveRes = await fetch(`${ORIGIN}/api/dev/save-workflow`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      workflowId: workflow.id,
      propertyId: PROPERTY,
      userId: USER,
      enabled: true,
      // Daily at 03:00 — a real cron, far from now, so pg_cron never fires it
      // on its own mid-run. The firing below is explicit.
      spec: scheduleSpec(project.id, project.name, "0 3 * * *"),
    }),
  });
  const savedOk = saveRes.ok;
  check(
    "spec saved through the workflows API",
    savedOk,
    savedOk ? "" : `${saveRes.status}: ${(await saveRes.text()).slice(0, 300)}`,
  );

  // THE assertion this file exists for.
  const { data: sched } = await supabase
    .from("workflow_schedules")
    .select("cron_expression, timezone, pg_cron_jobid")
    .eq("workflow_id", workflow.id)
    .maybeSingle();
  check(
    "a pg_cron job was registered",
    Boolean(sched?.pg_cron_jobid),
    "reconcileCronSchedule reads trigger.schedule.cron — a cron under trigger.filter validates and schedules NOTHING",
  );
  check(
    "with the cron we asked for",
    sched?.cron_expression === "0 3 * * *",
    `got ${JSON.stringify(sched?.cron_expression)}`,
  );

  // ── 2. Firing it produces a real conversation in the project ─────────────
  console.log("\n── Firing the schedule");
  const { error: emitErr } = await supabase.rpc("workflows_emit_cron_event", {
    p_workflow_id: workflow.id,
  });
  check("cron event emitted", !emitErr, emitErr?.message ?? "");

  // The dispatcher drains events; the inline after() race may already have
  // handled it, so draining is belt-and-braces rather than the only path.
  const drain = await fetch(`${ORIGIN}/api/workflows/drain`);
  check("dispatcher drained", drain.ok, `${drain.status}`);

  let chat = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(3000);
    const { data } = await supabase
      .from("assistant_chats")
      .select("id, title, project_id, source, workflow_id, eve_session_id")
      .eq("workflow_id", workflow.id)
      .maybeSingle();
    if (data?.eve_session_id) {
      chat = data;
      break;
    }
    if (data && !chat) chat = data;
  }

  check("the run created a conversation", Boolean(chat), "no assistant_chats row appeared");
  if (chat) {
    check("filed under the project", chat.project_id === project.id, `got ${chat.project_id}`);
    check("marked as a scheduled run", chat.source === "scheduled", `got ${chat.source}`);
    check("linked back to its schedule", chat.workflow_id === workflow.id, "");
    check(
      "an eve session was started",
      Boolean(chat.eve_session_id),
      "the conversation exists but no session — the runtime call failed",
    );
  }

  // ── 3. The run inherited the PROJECT's persona ───────────────────────────
  if (chat?.eve_session_id) {
    console.log("\n── Reading the run's transcript");
    // Read INCREMENTALLY and stop at the park. `res.text()` waits for the
    // stream to END, and a parked eve session's stream never does — so a
    // whole-body read always aborts on timeout with nothing, which reported
    // an empty transcript for a run that had answered perfectly well.
    async function readTranscript(sessionId) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      let text = "";
      try {
        const res = await fetch(`${ORIGIN}/eve/v1/session/${sessionId}/stream`, {
          headers: {
            authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            "x-hotelclaw-property": PROPERTY,
            "x-hotelclaw-user": USER,
            "x-hotelclaw-bot": "assistant",
            "x-hotelclaw-project": project.id,
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return "";
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let parked = false;
        while (!parked) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === "message.completed") {
                text += (text ? "\n" : "") + String(event.data?.message ?? "");
              } else if (event.type === "session.waiting") {
                parked = true;
              }
            } catch {
              // partial line
            }
          }
        }
        reader.cancel().catch(() => {});
      } catch {
        // Abort or transport hiccup — return whatever arrived.
      } finally {
        clearTimeout(timer);
      }
      return text;
    }

    let text = "";
    for (let attempt = 0; attempt < 12 && !text.trim(); attempt += 1) {
      await sleep(5000);
      text = await readTranscript(chat.eve_session_id);
    }
    check(
      "the scheduled run used the project's MEMORY",
      /kohler/i.test(text),
      `transcript=${JSON.stringify(text).slice(0, 400)}`,
    );
    if (text.trim()) {
      console.log(`      \u21b3 ${text.replace(/\s+/g, " ").slice(0, 180)}\u2026`);
    }
  }

  // ── 4. Disabling unregisters the job ─────────────────────────────────────
  console.log("\n── Disabling the schedule");
  const off = await fetch(`${ORIGIN}/api/dev/save-workflow`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      workflowId: workflow.id,
      propertyId: PROPERTY,
      userId: USER,
      enabled: false,
    }),
  });
  check("disable request accepted", off.ok, `${off.status}`);
  const { data: after } = await supabase
    .from("workflow_schedules")
    .select("workflow_id")
    .eq("workflow_id", workflow.id)
    .maybeSingle();
  check(
    "the pg_cron job was removed",
    !after,
    "a paused schedule that still holds a cron job keeps firing",
  );

  await cleanup({ projectId: project.id });
  console.log(`\n${failed ? "SCHEDULE SMOKE FAILED" : "SCHEDULE SMOKE PASSED"}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});
