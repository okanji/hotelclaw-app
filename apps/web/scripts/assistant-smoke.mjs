// Personal-assistant smoke test. Drives the REAL loop against the running dev
// server — no mocks, no shortcuts:
//
//   session create (x-hotelclaw-bot: assistant) → eve turn → NDJSON stream →
//   tool calls → reply → follow-up on the continuation token → project
//   persona injection (x-hotelclaw-project) → tenancy fencing.
//
// Unit tests cannot cover any of this: the assistant is a virtual agent whose
// persona, tools, and project context are assembled per-session inside the eve
// runtime, and the only way to know that assembly worked is to run a turn.
//
//   node --env-file=.env.local --no-network-family-autoselection \
//     scripts/assistant-smoke.mjs
//
// Fixtures carry an ASMOKE marker and are cleaned up at the end (including
// after a failure), so the run is safe to repeat.

import { createClient } from "@supabase/supabase-js";

const ORIGIN = process.env.DEV_ORIGIN ?? "http://127.0.0.1:3000";
const PROPERTY = process.env.ASSISTANT_TEST_PROPERTY ?? "c63d28a6-b8fb-452e-8eee-ebe1e0e4a4fa";
const USER = process.env.ASSISTANT_TEST_USER ?? "33831554-d1a7-4f62-85a5-85952cbc11e4";
// A REAL auth.users id who is not a member of PROPERTY — used to exercise the
// ownership guard. `user_id` is a foreign key, so a made-up UUID cannot be
// written and the fence probe would silently test nothing.
const OTHER_USER =
  process.env.ASSISTANT_TEST_OTHER_USER ?? "76d424cd-6a80-46a7-b0d3-326dcf518e43";
const MARKER = "ASMOKE";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

let failed = false;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `\n      ${extra}`}`);
  if (!cond) failed = true;
}

function headers(projectId, bot = "assistant", channelId = null) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "x-hotelclaw-property": PROPERTY,
    "x-hotelclaw-user": USER,
    "x-hotelclaw-bot": bot,
    ...(projectId ? { "x-hotelclaw-project": projectId } : {}),
    ...(channelId ? { "x-hotelclaw-channel": channelId } : {}),
  };
}

/**
 * Read a session's NDJSON stream, rebuilding the turn. The replay starts at
 * index 0 and includes every HISTORICAL park, so a follow-up must consume
 * until the park that FOLLOWS its own turn — stopping at the first one
 * returns the previous turn's reply (the mistake that has bitten every
 * consumer of these streams).
 */
async function readTurn(sessionId, expectedTurns, projectId, timeoutMs = 180_000, bot = "assistant", channelId = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${ORIGIN}/eve/v1/session/${sessionId}/stream`, {
    headers: headers(projectId, bot, channelId),
    signal: controller.signal,
  });
  if (!res.ok) {
    clearTimeout(timer);
    return { error: `stream ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let userTurns = 0;
  let text = "";
  const tools = [];
  let continuationToken = null;
  let sessionFailed = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        const data = event.data ?? {};
        if (event.type === "message.received") {
          userTurns += 1;
          if (userTurns === expectedTurns) {
            // Everything before OUR turn is history — start clean.
            text = "";
            tools.length = 0;
          }
        } else if (event.type === "message.completed" && userTurns >= expectedTurns) {
          text += (text ? "\n" : "") + String(data.message ?? "");
        } else if (event.type === "actions.requested" && userTurns >= expectedTurns) {
          for (const action of data.actions ?? []) {
            if (action.kind === "tool-call") tools.push(action.toolName);
          }
        } else if (event.type === "session.failed") {
          sessionFailed = JSON.stringify(data).slice(0, 400);
        } else if (event.type === "session.waiting") {
          continuationToken = data.continuationToken ?? null;
          if (userTurns >= expectedTurns) {
            controller.abort();
            clearTimeout(timer);
            return { text, tools, continuationToken, sessionFailed };
          }
        }
      }
    }
  } catch (err) {
    if (err?.name !== "AbortError") {
      clearTimeout(timer);
      return { error: String(err) };
    }
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
  return { text, tools, continuationToken, sessionFailed, timedOut: true };
}

async function turn({ sessionId, continuationToken, message, projectId, expectedTurns, bot = "assistant", channelId = null }) {
  const framed = `[Now: ${new Date().toISOString()} (UTC)]\n\n${message}`;
  const res = await fetch(
    sessionId ? `${ORIGIN}/eve/v1/session/${sessionId}` : `${ORIGIN}/eve/v1/session`,
    {
      method: "POST",
      headers: headers(projectId, bot, channelId),
      body: JSON.stringify(
        sessionId ? { continuationToken, message: framed } : { message: framed },
      ),
    },
  );
  if (!res.ok) return { error: `session POST ${res.status}: ${await res.text()}` };
  const body = await res.json();
  const id = body.sessionId ?? sessionId;
  const result = await readTurn(id, expectedTurns, projectId, 180_000, bot, channelId);
  return { sessionId: id, ...result };
}

async function cleanup() {
  await supabase.from("assistant_chats").delete().like("title", `%${MARKER}%`);
  await supabase.from("assistant_projects").delete().like("name", `%${MARKER}%`);
}

async function main() {
  console.log(`Assistant smoke — ${ORIGIN}, property ${PROPERTY.slice(0, 8)}\n`);
  await cleanup();

  // ── 1. A plain turn reaches the assistant persona and its tools ─────────
  console.log("── Plain conversation");
  const first = await turn({
    message:
      "In one short sentence: what surfaces of this workspace can you see and change? Then list up to three of my open tasks.",
    expectedTurns: 1,
  });
  check("first turn completes", !first.error && !first.sessionFailed, first.error ?? first.sessionFailed ?? "");
  check("assistant replied", Boolean(first.text?.trim()), `text=${JSON.stringify(first.text ?? "").slice(0, 200)}`);
  check(
    "reached a workspace tool",
    (first.tools ?? []).length > 0,
    `tools=${JSON.stringify(first.tools)}`,
  );
  check(
    "continuation token returned",
    Boolean(first.continuationToken),
    "without it, follow-ups cannot resume the session",
  );
  if (first.text) console.log(`      ↳ ${first.text.replace(/\s+/g, " ").slice(0, 180)}…`);

  // ── 2. The session is durable: a follow-up remembers turn one ───────────
  if (first.continuationToken) {
    console.log("\n── Follow-up on the same session");
    const second = await turn({
      sessionId: first.sessionId,
      continuationToken: first.continuationToken,
      message: "What did I just ask you? Answer in one sentence, no tools.",
      expectedTurns: 2,
    });
    check("follow-up completes", !second.error && !second.sessionFailed, second.error ?? second.sessionFailed ?? "");
    check(
      "the session remembered turn one",
      /task|surface|workspace|see|change/i.test(second.text ?? ""),
      `text=${JSON.stringify(second.text ?? "").slice(0, 240)}`,
    );
    if (second.text) console.log(`      ↳ ${second.text.replace(/\s+/g, " ").slice(0, 180)}…`);
  }

  // ── 3. Project instructions + memory reach the persona ──────────────────
  console.log("\n── Project persona injection");
  const { data: project, error: projectError } = await supabase
    .from("assistant_projects")
    .insert({
      property_id: PROPERTY,
      user_id: USER,
      name: `${MARKER} Villa`,
      description: "Smoke-test project.",
      // Deliberately an instruction with a checkable signature: a persona
      // that never arrived cannot produce this token.
      instructions:
        "You are working on Watamu Villa. ALWAYS end every reply with the exact line: SIGNAL-OK",
      memory: "The villa's backup generator is a Kohler 20kW installed in 2024.",
    })
    .select("id")
    .single();
  check("project fixture created", !projectError, projectError?.message ?? "");

  if (project) {
    const scoped = await turn({
      message: "Which generator does the villa have? One sentence.",
      projectId: project.id,
      expectedTurns: 1,
    });
    check("project turn completes", !scoped.error && !scoped.sessionFailed, scoped.error ?? scoped.sessionFailed ?? "");
    check(
      "project INSTRUCTIONS reached the persona",
      /SIGNAL-OK/.test(scoped.text ?? ""),
      `text=${JSON.stringify(scoped.text ?? "").slice(0, 300)}`,
    );
    check(
      "project MEMORY reached the persona",
      /kohler/i.test(scoped.text ?? ""),
      `text=${JSON.stringify(scoped.text ?? "").slice(0, 300)}`,
    );
    if (scoped.text) console.log(`      ↳ ${scoped.text.replace(/\s+/g, " ").slice(0, 180)}…`);

    // ── 4. Tenancy: a project that isn't yours is ignored ─────────────────
    // The project id arrives as a CLIENT header, so the runtime re-checks
    // ownership, property, and archival before injecting anything. Each guard
    // gets its own probe, and SIGNAL-OK is the tell: it can only appear if
    // that project's instructions reached the persona.
    //
    // HARNESS NOTE: the first cut of this test flipped `user_id` to an
    // all-zero UUID and ignored the update's error. `user_id` is a FK to
    // auth.users, so the write silently failed, the row still belonged to the
    // caller, and a CORRECT runtime was reported as leaking. Every mutation
    // below is asserted before the probe that depends on it.
    console.log("\n── Tenancy fence");

    const fences = [
      {
        name: "another user's project does NOT inject",
        // A real auth.users id that is not a member here — the ownership guard.
        mutate: () =>
          supabase
            .from("assistant_projects")
            .update({ user_id: OTHER_USER })
            .eq("id", project.id),
        verify: async () => {
          const { data } = await supabase
            .from("assistant_projects")
            .select("user_id")
            .eq("id", project.id)
            .single();
          return data?.user_id === OTHER_USER;
        },
        restore: () =>
          supabase
            .from("assistant_projects")
            .update({ user_id: USER })
            .eq("id", project.id),
      },
      {
        name: "an ARCHIVED project does NOT inject",
        mutate: () =>
          supabase
            .from("assistant_projects")
            .update({ archived_at: new Date().toISOString() })
            .eq("id", project.id),
        verify: async () => {
          const { data } = await supabase
            .from("assistant_projects")
            .select("archived_at")
            .eq("id", project.id)
            .single();
          return Boolean(data?.archived_at);
        },
        restore: () =>
          supabase
            .from("assistant_projects")
            .update({ archived_at: null })
            .eq("id", project.id),
      },
    ];

    for (const fence of fences) {
      const { error: mutateError } = await fence.mutate();
      const applied = !mutateError && (await fence.verify());
      check(`fixture for "${fence.name}" applied`, applied, mutateError?.message ?? "row unchanged");
      if (applied) {
        const fenced = await turn({
          message: "Which generator does the villa have? One sentence.",
          projectId: project.id,
          expectedTurns: 1,
        });
        check(
          fence.name,
          !/SIGNAL-OK/.test(fenced.text ?? ""),
          `leaked instructions: ${JSON.stringify(fenced.text ?? "").slice(0, 300)}`,
        );
      }
      await fence.restore();
    }

    // A project id that doesn't exist at all must be a no-op, not an error.
    const bogus = await turn({
      message: "Say READY and nothing else.",
      projectId: "11111111-2222-3333-4444-555555555555",
      expectedTurns: 1,
    });
    check(
      "an unknown project id degrades to the plain persona",
      !bogus.error && !bogus.sessionFailed && Boolean(bogus.text?.trim()),
      bogus.error ?? bogus.sessionFailed ?? "no reply",
    );
  }

  // ── 5. The chat row round-trips through the app's own action shape ──────
  console.log("\n── Chat row persistence");
  const { data: chat, error: chatError } = await supabase
    .from("assistant_chats")
    .insert({
      property_id: PROPERTY,
      user_id: USER,
      title: `${MARKER} chat`,
      eve_session_id: first.sessionId ?? null,
      continuation_token: first.continuationToken ?? null,
    })
    .select("id, eve_session_id, continuation_token")
    .single();
  check("chat row stores the session", !chatError && Boolean(chat?.eve_session_id), chatError?.message ?? "");
  check(
    "chat row stores the continuation token",
    Boolean(chat?.continuation_token),
    "a chat without one cannot be resumed after a reload",
  );

  // ── 6. REGRESSION: the channel bot is untouched ─────────────────────────
  // The assistant rides the channel bot's machinery — a shared resolver, two
  // slug-gated tool modules, and the shared instructions builder. A change
  // that quietly swallowed `hotelclaw` sessions would take the whole in-channel
  // bot down, so prove it still resolves to its own persona.
  console.log("\n── Channel-bot regression");
  const channelTurn = await turn({
    message:
      "In one short sentence, where are you and who are you talking to? Do not use tools.",
    bot: "hotelclaw",
    channelId: `prop-${PROPERTY.slice(0, 8)}-asmoke-probe`,
    expectedTurns: 1,
  });
  check(
    "the channel bot still resolves",
    !channelTurn.error && !channelTurn.sessionFailed && Boolean(channelTurn.text?.trim()),
    channelTurn.error ?? channelTurn.sessionFailed ?? "no reply",
  );
  // The tell is the NAME plus an in-chat setting. An earlier version of this
  // assertion required the literal words channel/team/slack, and failed a
  // perfectly correct bot that answered "working inside …'s ops chat" — the
  // regex, not the runtime, was wrong. Keep it loose: the assistant persona
  // says "your own full-page surface, not a team channel", so any chat-setting
  // phrasing distinguishes the two.
  const text = channelTurn.text ?? "";
  check(
    "and still has its CHANNEL persona, not the assistant's",
    /hotelclaw/i.test(text) && /chat|channel|team/i.test(text),
    `text=${JSON.stringify(text).slice(0, 300)}`,
  );
  if (channelTurn.text) {
    console.log(`      ↳ ${channelTurn.text.replace(/\s+/g, " ").slice(0, 180)}…`);
  }

  await cleanup();
  console.log(`\n${failed ? "SMOKE FAILED" : "SMOKE PASSED"}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});
