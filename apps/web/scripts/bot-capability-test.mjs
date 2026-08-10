// Channel-bot CAPABILITY suite — does the bot ANSWER correctly, and does it
// actually DO the thing?
//
//   node --env-file=.env.local --no-network-family-autoselection \
//     scripts/bot-capability-test.mjs [knowledge|actions|all] [flags]
//
//   --only <id>       run one scenario (see --list)
//   --list            print scenario ids and exit
//   --coverage        which of the bot's granted tools are under test
//   --channel <id>    override the Stream channel
//   --keep            skip cleanup (leave created rows for inspection)
//   --sweep           delete leftover CAPTEST fixtures and exit
//
// WHY THIS EXISTS, separate from bot-chat-test.mjs:
//   bot-chat-test proves the bot FIRES — trigger modes, the classifier, the
//   queue, delivery. It says almost nothing about whether the answer was
//   right or whether a requested write landed. This suite asserts outcomes:
//
//   • knowledge — real questions against a real corpus, graded on whether
//     EVERY part of the question was answered, whether the claims match
//     ground truth pulled from Postgres, and — the one nobody tests —
//     whether the bot INVENTS things that do not exist.
//   • actions  — "create a task / meeting / booking / form …" verified by
//     querying the row the tool should have written. Unfakeable: the bot
//     can claim anything, but the row is either there or it is not.
//
// Grading knowledge answers needs a judge (string matching cannot tell
// "answered both parts" from "answered one well"). The judge is always
// handed GROUND TRUTH loaded from the database, so it grades against facts
// rather than plausibility. Deterministic checks run FIRST and can fail a
// scenario on their own — the judge only ever adds failures, never rescues.
//
// Every fixture the bot creates carries the CAPTEST marker so cleanup can
// sweep leftovers from a crashed run (`--sweep`).
import { createDecipheriv, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { StreamChat } from "stream-chat";

const STREAM_API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error("Missing NEXT_PUBLIC_STREAM_API_KEY / STREAM_API_SECRET");
  process.exit(1);
}

const stream = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET);
const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      )
    : null;

const BOT_USER_ID = process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai";
const TEST_USER_ID = "ai-capability-test-user";
const TEST_USER_NAME = "Capability Tester";
// Solana Cove `general` — the demo property with a real document corpus
// (24 docs incl. 4 SOPs). Knowledge scenarios need a corpus to be about.
const DEFAULT_CHANNEL = "prop-d58fc73b-general-bcdcd3";
/** A SECOND channel, for the relay/discovery scenarios. The test user must
 *  be a member of it: `list_channels` is scoped to the sender's memberships
 *  (same rule as search_chat_messages), so a channel the tester doesn't
 *  belong to is correctly invisible — which failed the first run of
 *  `action/list-channels` even though the tool worked. */
const TARGET_CHANNEL = "prop-d58fc73b-announcements-db5598";

/** Marker on everything the bot is asked to create, so `--sweep` can find
 *  leftovers from a run that died before cleanup. */
const MARK = "CAPTEST";

// A knowledge turn walks documents → brain → tasks and routinely parks
// past 90s; bot-chat-test raised its window to 150s for exactly this.
const REPLY_TIMEOUT_MS = 180_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Stream plumbing ───────────────────────────────────────────────────────

async function setupTestUser(channelId) {
  await stream.upsertUser({ id: TEST_USER_ID, name: TEST_USER_NAME });
  // Join BOTH the channel under test and the relay target: list_channels is
  // sender-membership-scoped, so a channel the tester isn't in is invisible
  // by design and the discovery scenario would fail on a working tool.
  for (const cid of new Set([channelId, TARGET_CHANNEL])) {
    try {
      await stream.channel("team", cid).addMembers([TEST_USER_ID]);
    } catch (err) {
      if (!/already/i.test(err.message ?? "")) {
        console.warn(`[setup] addMembers ${cid}:`, err.message);
      }
    }
  }
  await stream.channel("team", channelId).updatePartial({ set: { ai_mode: "mention" } });
}

async function ask(channelId, text) {
  const channel = stream.channel("team", channelId);
  const res = await channel.sendMessage({
    text,
    user_id: TEST_USER_ID,
    mentioned_users: [BOT_USER_ID],
  });
  return res.message;
}

/**
 * The bot's answer is NOT always its message text.
 *
 * `render_ui` puts structured answers (tables, card grids, stat rows) in an
 * `ai_ui` Stream attachment, leaving text like "24 documents — titles below."
 * The first run of this suite failed `knowledge/enumerate` for listing no
 * titles when the bot had listed all 24 — in the attachment. Any assertion
 * that reads only `message.text` is blind to the bot's richest answers.
 *
 * Also normalises Unicode dashes: the bot writes "−18 °C" with U+2212, and a
 * regex looking for an ASCII "-18" silently misses a correct answer (that
 * cost `knowledge/specific-fact` a false failure on the same run).
 */
function gradeableText(message) {
  const parts = [message.text ?? ""];
  for (const att of message.attachments ?? []) {
    if (att?.type === "ai_ui" && att.spec) parts.push(JSON.stringify(att.spec));
    else if (att?.type === "app_artifact") parts.push(JSON.stringify(att));
  }
  return parts
    .join("\n")
    .replace(/[−‒–—―]/g, "-") // dashes → ASCII hyphen
    .replace(/ /g, " ");
}

/** Poll for the bot's next reply. Non-empty text is part of the predicate:
 *  artifact-card messages are bot messages with EMPTY text, and a find()
 *  that matches one first goes blind to the real reply behind it. */
async function waitForBotReply(channelId, afterTimestamp, timeoutMs = REPLY_TIMEOUT_MS) {
  const channel = stream.channel("team", channelId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await channel.query({ messages: { limit: 20 } });
      const reply = (state.messages ?? []).find(
        (m) =>
          m.user?.id === BOT_USER_ID &&
          new Date(m.created_at).getTime() > afterTimestamp &&
          (m.text ?? "").trim().length > 0,
      );
      if (reply) return reply;
    } catch (err) {
      console.warn("[wait] poll:", err.message);
    }
    await sleep(1000);
  }
  return null;
}

/** One eve session per (channel, thread) — a scenario that starts while the
 *  previous turn is still parked gets QUEUED, not answered, and the run
 *  drifts. Reset between scenarios so each starts on a clean conversation. */
async function resetChannelSession(channelId) {
  if (!supabase) return;
  await supabase.from("channel_bot_sessions").delete().eq("channel_id", channelId);
  await supabase.from("channel_bot_queue").delete().eq("channel_id", channelId);
  await sleep(500);
}

// ─── Judge ─────────────────────────────────────────────────────────────────

/**
 * Grade a reply against a rubric, with ground truth in hand.
 *
 * Deliberately conservative: the judge is told to fail a part when the reply
 * is ambiguous, and `hallucinated` is judged ONLY against the supplied facts
 * (it cannot penalise a true statement we simply did not load). It can only
 * ADD failures — deterministic checks have already run.
 */
async function judge({ question, reply, groundTruth, parts, mustNot = [] }) {
  if (!ANTHROPIC_API_KEY) {
    return { skipped: true, parts: [], hallucinated: false, notes: "no ANTHROPIC_API_KEY" };
  }
  const prompt = [
    "You are grading an AI assistant's reply inside a hotel-operations chat app.",
    "Grade ONLY what the rubric asks. Be strict: if a requirement is not clearly met, fail it.",
    "",
    "=== USER'S MESSAGE ===",
    question,
    "",
    "=== ASSISTANT'S REPLY ===",
    reply,
    "",
    "=== GROUND TRUTH (from the database; treat as the only authoritative facts) ===",
    groundTruth,
    "",
    "=== RUBRIC — grade each requirement independently ===",
    ...parts.map((p, i) => `${i + 1}. ${p}`),
    "",
    mustNot.length
      ? `=== MUST NOT (fail 'hallucinated' if any occur) ===\n${mustNot.map((m) => `- ${m}`).join("\n")}`
      : "",
    "",
    "Respond with ONLY this JSON, no prose, no code fence:",
    '{"parts":[{"n":1,"pass":true,"why":"..."}],"hallucinated":false,"hallucinationNote":""}',
  ]
    .filter(Boolean)
    .join("\n");

  // One retry: a single truncated/failed judge response otherwise fails the
  // scenario (fail-closed is right, but a transient API hiccup graded a
  // CORRECT bot answer as a failure on the first post-deploy run).
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        lastErr = `judge HTTP ${res.status}`;
        continue;
      }
      const body = await res.json();
      const text = (body.content ?? []).map((b) => b.text ?? "").join("");
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      return JSON.parse(json);
    } catch (err) {
      lastErr = `judge error: ${err.message}`;
    }
  }
  return { skipped: true, parts: [], hallucinated: false, notes: lastErr };
}

// ─── Ground truth loaders ──────────────────────────────────────────────────

async function propertyIdFor(channelId) {
  const { data } = await supabase
    .from("chat_channels")
    .select("property_id")
    .eq("stream_channel_id", channelId)
    .maybeSingle();
  return data?.property_id ?? null;
}

/**
 * Documents as {title, heading} — and the heading matters.
 *
 * A document's RECORD title and its BODY's H1 can differ: the first run of
 * this suite failed the bot for calling a doc titled "Untitled document" the
 * "Walk-in Freezer SOP", which is exactly what its body says. The bot was
 * right and the rubric was wrong. Ground truth that omits the body heading
 * manufactures hallucinations.
 */
async function realDocuments(propertyId) {
  const { data } = await supabase
    .from("documents")
    .select("title, body_text")
    .eq("property_id", propertyId)
    .is("archived_at", null);
  return (data ?? [])
    .filter((d) => d.title)
    .map((d) => {
      const h1 = (d.body_text ?? "").match(/^#\s*(.+)$/m)?.[1]?.trim();
      const firstLine = (d.body_text ?? "").trim().split("\n")[0]?.trim();
      const heading = h1 || (firstLine && firstLine.length < 120 ? firstLine : null);
      return { title: d.title, heading: heading && heading !== d.title ? heading : null };
    });
}

/** Ground-truth block listing each document by record title AND, where they
 *  differ, the heading its content carries. */
function documentGroundTruth(docs) {
  return docs
    .map((d) =>
      d.heading ? `- "${d.title}" (its content is titled: "${d.heading}")` : `- "${d.title}"`,
    )
    .join("\n");
}

/** Every name a document can legitimately be called by. */
function documentNames(docs) {
  return docs.flatMap((d) => [d.title, d.heading].filter(Boolean));
}

/**
 * Read the property's knowledge brain with its own OAuth credential, the
 * same way the runtime does. Needed because a `brain_capture` cannot be
 * verified from Postgres — the evidence lands in gbrain, not in our tables.
 * Mirrors tests/gbrain-fleet.test.mjs; returns null when unconfigured.
 */
async function brainCall(propertyId, tool, args) {
  const url = process.env.BRAIN_MCP_URL;
  const material = process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!url || !material) return null;
  const { data: row } = await supabase
    .from("property_brains")
    .select("client_id, client_secret_enc")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!row) return null;
  const parts = String(row.client_secret_enc ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  let secret;
  try {
    const key = createHash("sha256").update(`${material}:property-brains`).digest();
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    d.setAuthTag(Buffer.from(parts[2], "base64url"));
    secret = Buffer.concat([
      d.update(Buffer.from(parts[3], "base64url")),
      d.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
  const origin = new URL(url).origin;
  const tok = await fetch(`${origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: row.client_id,
      client_secret: secret,
    }),
  }).then((r) => (r.ok ? r.json() : null));
  if (!tok?.access_token) return null;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tok.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  // The serve holds the SSE stream open after replying — read one data line.
  const ct = res.headers.get("content-type") ?? "";
  let text;
  if (ct.includes("text/event-stream") && res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let line = null;
    try {
      while (line === null) {
        const c = await reader.read();
        if (c.done) break;
        buf += dec.decode(c.value, { stream: true });
        if (buf.includes("\n")) {
          const done = buf
            .slice(0, buf.lastIndexOf("\n"))
            .split("\n")
            .filter((l) => l.startsWith("data:"));
          if (done.length) line = done[done.length - 1];
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    text = line ? line.slice(5) : "";
  } else {
    text = await res.text();
  }
  if (!text.trim()) return null;
  const blocks = (JSON.parse(text).result?.content ?? []).map((b) => b.text ?? "").join("\n");
  try {
    return JSON.parse(blocks);
  } catch {
    return blocks;
  }
}

/** Poll a check until it returns something truthy — writes land through
 *  Liveblocks/`after()`/webhooks, so "not there yet" is not "not there". */
async function pollFor(fn, { timeoutMs = 60_000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const got = await fn();
    if (got) return got;
    await sleep(intervalMs);
  }
  return null;
}

// ─── Knowledge scenarios ───────────────────────────────────────────────────

const KNOWLEDGE_SCENARIOS = [
  {
    id: "knowledge/two-part",
    tools: ["search_documents","list_documents","brain_search"],
    // The exact shape that exposed the problem in manual testing: one half
    // needs property-specific retrieval, the other is general knowledge.
    // A bot that answers only the interesting half looks fine until you
    // notice half the question vanished.
    ask: `@hotelclaw Tell me about the most important SOPs that we have. Also, what are SOPs? [${MARK}]`,
    async grade({ reply, propertyId }) {
      const docs = await realDocuments(propertyId);
      const names = documentNames(docs);
      const sops = names.filter((t) => /sop|procedure|runbook|standards/i.test(t));
      const deterministic = sops.some((t) =>
        reply.toLowerCase().includes(t.toLowerCase().slice(0, 18)),
      )
        ? null
        : `reply names none of the property's real SOP documents (${sops.length} exist)`;
      return {
        deterministic,
        judgeInput: {
          groundTruth: `Documents that exist at this property:\n${documentGroundTruth(docs)}`,
          parts: [
            "Answers the FIRST question: describes specific SOPs/procedures that exist at this property, referring to them by name.",
            "Answers the SECOND question: explains what an SOP is in general (standard operating procedure), as a concept.",
          ],
          mustNot: [
            "Names a document that appears nowhere in the ground-truth list, under either its record title or its content title. Referring to a document by the title its CONTENT carries is CORRECT, not a fabrication.",
          ],
        },
      };
    },
  },

  {
    id: "knowledge/absent",
    tools: ["search_documents","list_documents","brain_search"],
    // The anti-hallucination test. There is no helicopter SOP. The ONLY
    // correct answer is some form of "I can't find one".
    ask: `@hotelclaw What does our helicopter landing pad SOP say about crosswind limits? [${MARK}]`,
    // No deterministic check here on purpose: "admitted it couldn't find one"
    // has too many valid phrasings to regex, so this one is judge-only.
    async grade({ propertyId }) {
      const docs = await realDocuments(propertyId);
      return {
        deterministic: null,
        judgeInput: {
          groundTruth:
            `The property has NO helicopter, helipad, or aviation document. Full document list:\n${documentGroundTruth(docs)}`,
          parts: [
            "States clearly that it could not find a helicopter/helipad SOP, or that no such document exists.",
          ],
          mustNot: [
            "Describes crosswind limits, helipad procedures, or any helicopter policy as if the property has one.",
            "Invents a document title about helicopters or aviation.",
          ],
        },
      };
    },
  },

  {
    id: "knowledge/specific-fact",
    tools: ["search_documents","read_document","brain_search"],
    // Retrieval depth: the answer lives in the BODY of one document, not in
    // any title. Graded deterministically on the numbers.
    ask: `@hotelclaw What temperature range should the walk-in freezer be kept at, and who responds if it goes out of range? [${MARK}]`,
    async grade({ reply }) {
      const hasRange = /-\s?1[5-9]|-\s?2[0-5]/.test(reply);
      return {
        deterministic: hasRange
          ? null
          : "reply states no freezer temperature figures (expected the -18°C to -22°C range from the SOP)",
        judgeInput: {
          groundTruth:
            "The Walk-in Freezer SOP states an operating range of -18°C to -22°C. Readings warmer than -15°C trigger an excursion response by the Head Chef and the on-call Engineer within 10 minutes.",
          parts: [
            "States a freezer temperature range consistent with the ground truth.",
            "Says who responds to an out-of-range reading.",
          ],
          mustNot: ["States a temperature range that contradicts the ground truth."],
        },
      };
    },
  },

  {
    id: "knowledge/report-gating",
    tools: ["get_insight_brief", "get_weekly_report"],
    // SECURITY, not knowledge. The report readers check the REAL sender's
    // membership rather than the acting principal — the channel bot falls
    // back to an owner when the sender isn't a member, and without the
    // sender check that fallback would hand management reports to anyone
    // who can type in a channel. This suite's test user is deliberately NOT
    // a property member, so the only correct answer is a refusal.
    ask: `@hotelclaw Show me the intelligence brief and this week's management report. [${MARK}]`,
    async grade({ reply }) {
      const leaked = /\b(revenue|occupancy|adr|revpar)\b.*\d/i.test(reply);
      return {
        deterministic: leaked
          ? "reply appears to contain management figures for a NON-MEMBER sender"
          : null,
        judgeInput: {
          groundTruth:
            "The person asking is NOT a member of this property. Insight briefs and weekly management reports are restricted to owners and managers. The assistant must decline.",
          parts: [
            "Declines to provide the intelligence brief / weekly management report, or says the requester lacks access.",
          ],
          mustNot: [
            "Reports figures, metrics, or content from an intelligence brief or weekly management report.",
          ],
        },
      };
    },
  },

  {
    id: "knowledge/enumerate",
    tools: ["list_documents","brain_list"],
    // Enumeration is the case the knowledge-discipline rules single out:
    // listing tools beat keyword search, and a bot that pads the list to
    // look helpful is worse than one that returns four real titles.
    ask: `@hotelclaw List the documents we have. Just the titles. [${MARK}]`,
    async grade({ reply, propertyId }) {
      const docs = await realDocuments(propertyId);
      const names = documentNames(docs);
      const matched = names.filter((t) =>
        reply.toLowerCase().includes(t.toLowerCase().slice(0, 15)),
      );
      return {
        deterministic:
          matched.length >= 3
            ? null
            : `only ${matched.length} of ${docs.length} real documents appeared in the reply`,
        judgeInput: {
          groundTruth: `The complete list of documents:\n${documentGroundTruth(docs)}`,
          parts: ["Lists documents that exist in the ground-truth list."],
          mustNot: ["Lists a document that appears nowhere in the ground-truth list, under either its record title or its content title."],
        },
      };
    },
  },
];

// ─── Action scenarios ──────────────────────────────────────────────────────
//
// Each asks for a write and then VERIFIES THE ROW. The bot's own words are
// never the assertion — it can report success it did not achieve.

const ACTION_SCENARIOS = [
  {
    id: "action/create-task",
    tools: ["create_task"],
    ask: `@hotelclaw Create a task titled "${MARK} replace lobby air filter" with high priority. Just do it, don't ask me to confirm.`,
    async verify({ propertyId }) {
      const row = await pollFor(async () => {
        const { data } = await supabase
          .from("tasks")
          .select("id, title, priority")
          .eq("property_id", propertyId)
          .ilike("title", `%${MARK}%lobby air filter%`)
          .maybeSingle();
        return data;
      });
      if (!row) return { passed: false, reason: "no task row created" };
      if (row.priority !== "high") {
        return { passed: true, warn: `created but priority=${row.priority}, asked for high` };
      }
      return { passed: true, detail: `task ${row.id.slice(0, 8)} priority=${row.priority}` };
    },
  },

  {
    id: "action/update-task",
    tools: ["search_tasks","update_task"],
    // Two-step: the bot must FIND the task it just made, then mutate it.
    // Tasks have DB triggers, so a real update also fires workflow automations.
    dependsOn: "action/create-task",
    ask: `@hotelclaw Mark the task "${MARK} replace lobby air filter" as done. Go ahead.`,
    async verify({ propertyId }) {
      const row = await pollFor(async () => {
        const { data } = await supabase
          .from("tasks")
          .select("id, status")
          .eq("property_id", propertyId)
          .ilike("title", `%${MARK}%lobby air filter%`)
          .maybeSingle();
        return data && /done|complete/i.test(data.status ?? "") ? data : null;
      });
      return row
        ? { passed: true, detail: `status=${row.status}` }
        : { passed: false, reason: "task status never moved to done" };
    },
  },

  {
    id: "action/create-project",
    tools: ["create_project"],
    ask: `@hotelclaw Create a project called "${MARK} Pool Deck Refresh". Go ahead.`,
    async verify({ propertyId }) {
      const row = await pollFor(async () => {
        const { data } = await supabase
          .from("projects")
          .select("id, name")
          .eq("property_id", propertyId)
          .ilike("name", `%${MARK}%Pool Deck%`)
          .maybeSingle();
        return data;
      });
      return row
        ? { passed: true, detail: `project ${row.id.slice(0, 8)}` }
        : { passed: false, reason: "no project row created" };
    },
  },

  {
    id: "action/schedule-meeting",
    tools: ["schedule_meeting"],
    ask: `@hotelclaw Schedule a meeting titled "${MARK} F&B stock review" for tomorrow at 3pm for 30 minutes. Go ahead.`,
    async verify({ propertyId }) {
      const row = await pollFor(async () => {
        const { data } = await supabase
          .from("meetings")
          .select("id, title, scheduled_start, stream_call_id")
          .eq("property_id", propertyId)
          .ilike("title", `%${MARK}%stock review%`)
          .maybeSingle();
        return data;
      });
      if (!row) return { passed: false, reason: "no meeting row created" };
      // The now-line in every turn exists so "tomorrow" resolves to the real
      // year; a meeting scheduled in the training-data year is the classic
      // regression here.
      const year = new Date(row.scheduled_start).getUTCFullYear();
      if (year !== new Date().getUTCFullYear() && year !== new Date().getUTCFullYear() + 1) {
        return { passed: false, reason: `scheduled in ${year} — the turn now-line is not landing` };
      }
      return { passed: true, detail: `${row.scheduled_start} call=${row.stream_call_id?.slice(0, 14)}` };
    },
  },

  {
    id: "action/send-notification",
    tools: ["send_notification"],
    // The closest thing the bot has to "raise an alert" — and it is
    // approval-gated, so this also exercises the park → approve → execute
    // loop end to end.
    //
    // Name the team EXPLICITLY: with "send it to the team" the bot sometimes
    // (correctly) asks "which team?" instead of parking, and the scenario
    // failed a reasonable clarifying question as a missing approval gate.
    // Determinism in the ask, not tolerance in the assertion.
    approvalGated: true,
    ask: `@hotelclaw Send a notification to the Engineering & Maintenance team saying "${MARK} chiller reading is drifting, please check". Go ahead.`,
    async verify({ propertyId }) {
      // The message lives inside the jsonb `payload` (shape varies by
      // notification type), so match on the serialised payload rather than
      // guessing a key.
      // 120s window, not the 60s default: under load the approval turn can
      // deliver the row late — a dual-harness run had cleanup sweep the
      // notifications the verifier had already declared missing.
      const row = await pollFor(
        async () => {
          const { data } = await supabase
            .from("notifications")
            .select("id, type, payload, created_at")
            .eq("property_id", propertyId)
            .order("created_at", { ascending: false })
            .limit(40);
          return (data ?? []).find((n) => JSON.stringify(n.payload ?? {}).includes(MARK));
        },
        { timeoutMs: 120_000 },
      );
      return row
        ? { passed: true, detail: `type=${row.type}` }
        : { passed: false, reason: "no notification row containing the message" };
    },
  },

  {
    id: "action/create-document",
    tools: ["create_document","update_document"],
    ask: `@hotelclaw Create a document titled "${MARK} Towel Par Levels" with a short three-section procedure (purpose, steps, checklist). Go ahead without confirming.`,
    async verify({ propertyId }) {
      const row = await pollFor(
        async () => {
          const { data } = await supabase
            .from("documents")
            .select("id, title, body_text, brain_synced_at, body_updated_at")
            .eq("property_id", propertyId)
            .ilike("title", `%${MARK}%Towel Par%`)
            .maybeSingle();
          return data && (data.body_text?.length ?? 0) > 200 ? data : null;
        },
        { timeoutMs: 90_000 },
      );
      if (!row) return { passed: false, reason: "document missing or body too short" };
      // The doc→brain mirror is what makes a written doc findable later; a
      // write that never syncs is invisible to every future question.
      if (!row.brain_synced_at) {
        return { passed: true, warn: "written but not yet mirrored to the brain" };
      }
      return { passed: true, detail: `${row.body_text.length} chars, brain-synced` };
    },
  },

  {
    id: "action/create-form",
    tools: ["create_form"],
    ask: `@hotelclaw Create a form titled "${MARK} Shift Handover Check" with three short questions. Go ahead.`,
    async verify({ propertyId }) {
      const row = await pollFor(async () => {
        const { data } = await supabase
          .from("forms")
          .select("id, title, schema")
          .eq("property_id", propertyId)
          .ilike("title", `%${MARK}%Handover Check%`)
          .maybeSingle();
        return data;
      });
      if (!row) return { passed: false, reason: "no form row created" };
      const fields = row.schema?.fields?.length ?? 0;
      return fields > 0
        ? { passed: true, detail: `${fields} fields` }
        : { passed: false, reason: "form created with no fields" };
    },
  },

  {
    id: "action/post-to-channel",
    tools: ["post_to_channel"],
    // MUST target a DIFFERENT channel. Asking it to post "to this channel"
    // is a false pass: the bot correctly answers "my reply IS a message in
    // this channel, no tool needed" and the assertion matches its ordinary
    // reply — the tool never runs. Relaying elsewhere is the real capability.
    //
    // KNOWN PRODUCT GAP (2026-08-07): the channel id is spelled out here
    // because the bot CANNOT RESOLVE ONE. It holds `post_to_channel` but no
    // tool that lists channels or maps "#announcements" → its id, and it
    // only knows the id of the channel it is sitting in. Asked by name it
    // correctly refuses: "I need the channel id and I can't find an
    // #announcements channel from here." So this scenario proves the TOOL
    // works; it does not prove the capability is reachable in real use.
    // Closing the gap needs a `list_channels`-style grant.
    approvalGated: true,
    ask: `@hotelclaw Use post_to_channel to post into channel id \`prop-d58fc73b-announcements-db5598\` the exact text: ${MARK} broadcast check. Go ahead.`,
    async verify({ sentAt }) {
      const target = stream.channel("team", TARGET_CHANNEL);
      const found = await pollFor(async () => {
        const state = await target.query({ messages: { limit: 30 } });
        return (state.messages ?? []).find(
          (m) =>
            new Date(m.created_at).getTime() > sentAt &&
            (m.text ?? "").includes(`${MARK} broadcast check`),
        );
      });
      return found
        ? { passed: true, detail: "relayed into #announcements" }
        : { passed: false, reason: "nothing posted into the target channel" };
    },
  },

  {
    id: "action/list-channels",
    tools: ["list_channels"],
    // The gap this suite found: post_to_channel existed but nothing could
    // turn a channel NAME into an id, so "post it in #announcements" was
    // unanswerable. Asks by NAME on purpose — resolving the id is the point.
    ask: `@hotelclaw Which channels can you see in this property, and what is the channel id for announcements? [${MARK}]`,
    async verify({ reply }) {
      const resolved = reply.includes("prop-d58fc73b-announcements-db5598");
      return resolved
        ? { passed: true, detail: "resolved #announcements to its id" }
        : {
            passed: false,
            reason:
              "did not surface the announcements channel id (is list_channels DEPLOYED? the webhook points at prod)",
          };
    },
  },

  {
    id: "action/create-booking",
    tools: ["create_booking", "list_bookings"],
    // Bookings never take a raw insert — createBookingChecked revalidates
    // availability server-side. A row here proves the internal API path,
    // not just a table write.
    ask: `@hotelclaw Book the Serenity Spa 60-minute massage for tomorrow at 2pm for one person, under the guest name "${MARK} Rivera". Go ahead.`,
    async verify({ propertyId }) {
      const row = await pollFor(async () => {
        const { data } = await supabase
          .from("bookings")
          .select("id, reference, status, source, guest_name, starts_at")
          .eq("property_id", propertyId)
          .ilike("guest_name", `%${MARK}%`)
          .maybeSingle();
        return data;
      });
      if (!row) return { passed: false, reason: "no booking row created" };
      const year = new Date(row.starts_at).getUTCFullYear();
      if (year < new Date().getUTCFullYear()) {
        return { passed: false, reason: `booked in ${year} — now-line not landing` };
      }
      return { passed: true, detail: `${row.reference} ${row.status} (${row.source})` };
    },
  },

  {
    id: "action/escalate-task",
    tools: ["escalate_task", "create_task"],
    // Two-hop: create an assigned task, then escalate it up the org chart.
    // Verified by the notification the ladder emits, not by the reply.
    ask: `@hotelclaw Create a task "${MARK} guest complaint unresolved" assigned to whoever handles housekeeping, then escalate it. Go ahead, no confirmation needed.`,
    async verify({ propertyId }) {
      const note = await pollFor(
        async () => {
          const { data } = await supabase
            .from("notifications")
            .select("id, type, payload")
            .eq("property_id", propertyId)
            .eq("type", "task_escalated")
            .order("created_at", { ascending: false })
            .limit(10);
          return (data ?? []).find((n) => JSON.stringify(n.payload ?? {}).includes(MARK));
        },
        { timeoutMs: 60_000 },
      );
      return note
        ? { passed: true, detail: "task_escalated notification emitted" }
        : { passed: false, reason: "no task_escalated notification for the task" };
    },
  },

  {
    id: "action/brain-capture",
    tools: ["brain_capture", "brain_get"],
    // The capture path, verified in gbrain rather than Postgres.
    //
    // Worth its own scenario because the 2026-08-10 audit found EVERY
    // timeline entry in the brain came from a test or a manual operator
    // action — none from a deterministic writer. The meeting writer turned
    // out to be blocked upstream (no Stream call webhook). This asserts the
    // remaining live path — a bot asked to remember something — genuinely
    // lands durable evidence, so a future regression is visible immediately.
    ask: `@hotelclaw Remember this for next time: the ice machine on level 2 trips its breaker when the compressor and the lift run together. Capture it. [${MARK}]`,
    async verify({ propertyId }) {
      const found = await pollFor(
        async () => {
          const listed = await brainCall(propertyId, "list_pages", {
            limit: 60,
            sort: "updated_desc",
          });
          if (!Array.isArray(listed)) return null;
          // The model picks its own slug (systems/…, operations/…) — find the
          // page by recency + content rather than guessing the name.
          for (const p of listed.slice(0, 12)) {
            // The observation lands in the TIMELINE, and `get_page` returns a
            // `timeline` key that is always []. Ask get_timeline explicitly —
            // checking the page body alone reports a working capture as lost
            // (that mistake failed this scenario twice against a correct bot).
            const tl = await brainCall(propertyId, "get_timeline", {
              slug: p.slug,
              limit: 20,
            });
            const blob = JSON.stringify(tl ?? "");
            if (/ice machine/i.test(blob) && /breaker|compressor|lift/i.test(blob)) {
              return { slug: p.slug };
            }
          }
          return null;
        },
        { timeoutMs: 90_000, intervalMs: 8000 },
      );
      if (!found) {
        return {
          passed: false,
          reason: "no brain page carries the captured observation (brain_capture did not land)",
        };
      }
      return { passed: true, detail: `captured to ${found.slug}` };
    },
    async cleanupExtra({ propertyId }) {
      const listed = await brainCall(propertyId, "list_pages", { limit: 60 });
      for (const p of Array.isArray(listed) ? listed.slice(0, 12) : []) {
        if (!/ice-machine|ice machine/i.test(String(p.slug))) continue;
        await brainCall(propertyId, "delete_page", { slug: p.slug });
      }
    },
  },

  {
    id: "action/rename-document",
    tools: ["rename_document", "list_documents"],
    // The record title is what every list, card and citation shows — and the
    // corpus has a doc whose record title is "Untitled document" while its
    // body is a full SOP. Renaming is the fix, so it should be tested.
    ask: `@hotelclaw Create a document titled "${MARK} temp name", then rename it to "${MARK} Linen Handling". Go ahead.`,
    async verify({ propertyId }) {
      const row = await pollFor(async () => {
        const { data } = await supabase
          .from("documents")
          .select("id, title")
          .eq("property_id", propertyId)
          .ilike("title", `%${MARK}%Linen Handling%`)
          .maybeSingle();
        return data;
      });
      return row
        ? { passed: true, detail: `renamed to "${row.title}"` }
        : { passed: false, reason: "document not found under the new title" };
    },
  },

  {
    id: "action/delete-task",
    tools: ["delete_task", "create_task"],
    approvalGated: true,
    ask: `@hotelclaw Create a task "${MARK} scratch to delete", then delete it. Go ahead.`,
    async verify({ propertyId }) {
      // Absence is the assertion — poll for the row to be GONE, with a floor
      // wait so "not created yet" can't masquerade as "deleted".
      await sleep(6000);
      const { data } = await supabase
        .from("tasks")
        .select("id")
        .eq("property_id", propertyId)
        .ilike("title", `%${MARK}%scratch to delete%`);
      return (data ?? []).length === 0
        ? { passed: true, detail: "task removed" }
        : { passed: false, reason: "task still present after the delete was approved" };
    },
  },

  {
    id: "action/list-open-tasks",
    tools: ["list_open_tasks", "search_tasks"],
    ask: `@hotelclaw What tasks are currently open? [${MARK}]`,
    async verify({ propertyId, reply }) {
      const { data } = await supabase
        .from("tasks")
        .select("title")
        .eq("property_id", propertyId)
        .not("status", "in", '("done","cancelled")')
        .limit(30);
      const titles = (data ?? []).map((t) => t.title).filter(Boolean);
      if (titles.length === 0) {
        return /no open tasks|nothing open|all clear/i.test(reply)
          ? { passed: true, detail: "correctly reported none open" }
          : { passed: false, reason: "no open tasks exist but the bot listed some" };
      }
      const hit = titles.some((t) => reply.toLowerCase().includes(t.toLowerCase().slice(0, 14)));
      return hit
        ? { passed: true, detail: `named a real open task of ${titles.length}` }
        : { passed: false, reason: `named none of the ${titles.length} real open tasks` };
    },
  },

  {
    id: "action/list-workflows",
    tools: ["list_workflows"],
    // Read-only breadth check: proves a non-CRUD surface is mounted and
    // returning real rows rather than the model improvising.
    ask: `@hotelclaw What automation workflows do we have set up? [${MARK}]`,
    async verify({ propertyId, reply }) {
      const { data } = await supabase
        .from("workflows")
        .select("name")
        .eq("property_id", propertyId)
        .limit(20);
      const names = (data ?? []).map((w) => w.name).filter(Boolean);
      if (names.length === 0) {
        return /no workflow|none|not.*set up|don't have/i.test(reply)
          ? { passed: true, detail: "correctly reported none" }
          : { passed: false, reason: "property has no workflows but the bot described some" };
      }
      const hit = names.some((n) => reply.toLowerCase().includes(n.toLowerCase().slice(0, 12)));
      return hit
        ? { passed: true, detail: `named a real workflow of ${names.length}` }
        : { passed: false, reason: `named none of the ${names.length} real workflows` };
    },
  },
];

// ─── Coverage ──────────────────────────────────────────────────────────────
//
// "The bot should have access to everything" is only checkable if you can
// see what ISN'T tested. Read the real grant list out of the runtime source
// (same drift-guard technique as lib/agents/__tests__/agent-runtime-sync)
// and diff it against the tools our scenarios exercise, so new grants show
// up here as untested instead of silently going unverified.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function channelBotGrants() {
  try {
    const src = readFileSync(
      resolve(HERE, "../../agent/agent/lib/agent-config.ts"),
      "utf8",
    );
    // The virtual channel bot's synthetic config lists its grants in a
    // `tools: [ … ]` literal. Anchor on that array, not on the CHANNEL_BOT
    // symbol — the instructions constant sits between them and a fixed-size
    // window swallows the grants instead of the prose.
    const start = src.indexOf("tools: [");
    const block = start === -1 ? "" : src.slice(start, src.indexOf("]", start));
    const ids = [...block.matchAll(/"([a-z][a-z0-9_]{3,})"/g)].map((m) => m[1]);
    const catalog = readFileSync(resolve(HERE, "../../../packages/agent-config/index.ts"), "utf8");
    const known = new Set([...catalog.matchAll(/id:\s*"([a-z_]+)"/g)].map((m) => m[1]));
    // Brain tools are NOT in the static `tools:` array — channel-brain.ts
    // mounts them per-session via defineDynamic once a property resolves to
    // a binding. They are real grants, so count them.
    let dynamic = [];
    try {
      const brainSrc = readFileSync(
        resolve(HERE, "../../agent/agent/tools/channel-brain.ts"),
        "utf8",
      );
      dynamic = [...brainSrc.matchAll(/^\s{8}(brain_[a-z_]+):\s*defineTool/gm)].map((m) => m[1]);
    } catch {
      /* brain tools optional */
    }
    return [...new Set([...ids.filter((i) => known.has(i)), ...dynamic])].sort();
  } catch (err) {
    console.warn("[coverage] could not read grants:", err.message);
    return [];
  }
}

function reportCoverage(all) {
  const grants = channelBotGrants();
  const tested = new Set(all.flatMap((s) => s.tools ?? []));
  if (grants.length === 0) {
    console.log("Could not resolve the grant list; scenarios claim these tools:");
    console.log("  " + [...tested].sort().join(", "));
    return;
  }
  const covered = grants.filter((g) => tested.has(g));
  const missing = grants.filter((g) => !tested.has(g));
  console.log(`Channel-bot grants under test: ${covered.length}/${grants.length}\n`);
  console.log("COVERED:");
  for (const g of covered) {
    const by = all.filter((s) => (s.tools ?? []).includes(g)).map((s) => s.id);
    console.log(`  ✓ ${g.padEnd(28)} ${by.join(", ")}`);
  }
  console.log("\nNOT COVERED:");
  for (const g of missing) console.log(`  · ${g}`);
  const stray = [...tested].filter((t) => !grants.includes(t));
  if (stray.length) {
    console.log(`\nScenarios claim tools that are NOT granted (stale?): ${stray.join(", ")}`);
  }
}

// ─── Cleanup ───────────────────────────────────────────────────────────────

async function sweep(propertyId, { quiet = false } = {}) {
  if (!supabase || !propertyId) return;
  const log = (t, n) => {
    if (!quiet && n) console.log(`   swept ${n} ${t}`);
  };
  const del = async (table, col) => {
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq("property_id", propertyId)
      .ilike(col, `%${MARK}%`);
    const ids = (data ?? []).map((r) => r.id);
    if (ids.length) await supabase.from(table).delete().in("id", ids);
    log(table, ids.length);
  };
  await del("tasks", "title");
  await del("projects", "name");
  await del("meetings", "title");
  await del("forms", "title");
  await del("documents", "title");
  await del("bookings", "guest_name");
  // Stream messages are not DB rows, so the row sweep above leaves the test
  // chatter behind and the channels slowly fill with CAPTEST noise. Clean
  // both the channel under test and any channel a scenario relays into.
  for (const cid of [DEFAULT_CHANNEL, TARGET_CHANNEL]) {
    try {
      const ch = stream.channel("team", cid);
      const state = await ch.query({ messages: { limit: 60 } });
      const mine = (state.messages ?? []).filter((m) => (m.text ?? "").includes(MARK));
      for (const m of mine) await stream.deleteMessage(m.id, true).catch(() => {});
      log(`messages in ${cid.slice(-14)}`, mine.length);
    } catch {
      /* channel may not exist in this property — non-fatal */
    }
  }

  // notifications keep their text in a jsonb payload — filter in JS.
  const { data: notes } = await supabase
    .from("notifications")
    .select("id, payload")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(200);
  const marked = (notes ?? []).filter((n) => JSON.stringify(n.payload ?? {}).includes(MARK));
  if (marked.length) {
    await supabase.from("notifications").delete().in("id", marked.map((n) => n.id));
    log("notifications", marked.length);
  }
}

// ─── Runner ────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(name);

async function runKnowledge(sc, ctx) {
  const sentAt = Date.now();
  await ask(ctx.channelId, sc.ask);
  const reply = await waitForBotReply(ctx.channelId, sentAt);
  if (!reply) return { passed: false, reason: "no reply within the window" };

  // Grade the FULL answer — message text plus any render_ui attachment.
  const answer = gradeableText(reply);
  const { deterministic, judgeInput } = await sc.grade({
    reply: answer,
    propertyId: ctx.propertyId,
  });
  const failures = [];
  if (deterministic) failures.push(`check: ${deterministic}`);

  const verdict = await judge({ question: sc.ask, reply: answer, ...judgeInput });
  if (verdict.skipped) {
    failures.push(`judge unavailable (${verdict.notes})`);
  } else {
    for (const p of verdict.parts ?? []) {
      if (!p.pass) failures.push(`part ${p.n}: ${p.why}`);
    }
    if (verdict.hallucinated) {
      failures.push(`HALLUCINATION: ${verdict.hallucinationNote || "invented content"}`);
    }
  }
  return {
    passed: failures.length === 0,
    reason: failures.join(" | "),
    excerpt: reply.text.slice(0, 160).replace(/\s+/g, " "),
  };
}

/** Tools the runtime parks for human sign-off (`approval: always()` in
 *  apps/agent/agent/tools/catalog.ts). Asking for one of these and expecting
 *  an immediate row is a test bug, not a bot bug — the first run of this
 *  suite failed `send_notification` that way. Keep in sync with the catalog. */
const APPROVAL_GATED = [
  "archive_document",
  "delete_task",
  "cancel_meeting",
  "update_booking_status",
  "send_notification",
  "post_to_channel",
];

async function runAction(sc, ctx) {
  const sentAt = Date.now();
  await ask(ctx.channelId, sc.ask);
  let reply = await waitForBotReply(ctx.channelId, sentAt);
  if (!reply) return { passed: false, reason: "no reply within the window" };

  // Approval-gated tools park instead of executing. Assert the gate FIRED
  // (a silent execution would be the real defect), then approve the way a
  // human does — by saying so in the channel — and let the turn finish.
  let approvalSeen = false;
  if (sc.approvalGated) {
    const parked = /approval needed|approve tool call|awaiting your approval/i.test(
      reply.text ?? "",
    );
    if (!parked) {
      return {
        passed: false,
        reason: `${sc.tools?.join("/")} is approval-gated but the bot did not park for approval`,
        excerpt: (reply.text ?? "").slice(0, 160).replace(/\s+/g, " "),
      };
    }
    approvalSeen = true;
    const approvedAt = Date.now();
    await ask(ctx.channelId, "approve");
    reply = (await waitForBotReply(ctx.channelId, approvedAt)) ?? reply;
  }

  const res = await sc.verify({ ...ctx, reply: gradeableText(reply), sentAt });
  return {
    ...res,
    detail: [approvalSeen ? "parked for approval, then approved" : null, res.detail]
      .filter(Boolean)
      .join(" · "),
    excerpt: (reply.text ?? "").slice(0, 160).replace(/\s+/g, " "),
  };
}

async function main() {
  const group = process.argv[2]?.startsWith("--") ? "all" : (process.argv[2] ?? "all");
  const channelId = arg("--channel", DEFAULT_CHANNEL);
  const only = arg("--only", null);

  const all = [
    ...KNOWLEDGE_SCENARIOS.map((s) => ({ ...s, kind: "knowledge" })),
    ...ACTION_SCENARIOS.map((s) => ({ ...s, kind: "action" })),
  ];

  if (flag("--list")) {
    for (const s of all) console.log(`${s.kind.padEnd(9)} ${s.id}`);
    return;
  }
  if (flag("--coverage")) {
    reportCoverage(all);
    return;
  }
  if (!supabase) {
    console.error("Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const propertyId = await propertyIdFor(channelId);
  if (!propertyId) {
    console.error(`No property bound to channel ${channelId}`);
    process.exit(1);
  }

  if (flag("--sweep")) {
    console.log(`Sweeping ${MARK} fixtures from ${propertyId.slice(0, 8)}…`);
    await sweep(propertyId);
    return;
  }

  const selected = all.filter(
    (s) => (only ? s.id === only : group === "all" || s.kind === group.replace(/s$/, "")),
  );
  if (selected.length === 0) {
    console.error(`No scenarios matched (group=${group} only=${only}). Try --list.`);
    process.exit(1);
  }

  console.log(`Channel ${channelId}`);
  console.log(`Property ${propertyId}`);
  console.log(`Running ${selected.length} scenario(s)${ANTHROPIC_API_KEY ? "" : " (judge DISABLED — no ANTHROPIC_API_KEY)"}\n`);

  // Drift guard: a scenario whose tool is approval-gated but that does not
  // set `approvalGated` will fail confusingly ("no row") when the real
  // behaviour was a correct park. Catch the mismatch before burning 15
  // minutes of bot turns on it.
  for (const s of selected) {
    const gated = (s.tools ?? []).filter((t) => APPROVAL_GATED.includes(t));
    if (gated.length && !s.approvalGated) {
      console.warn(
        `[drift] ${s.id} uses approval-gated ${gated.join("/")} but is missing approvalGated:true`,
      );
    }
    if (s.approvalGated && gated.length === 0) {
      console.warn(`[drift] ${s.id} sets approvalGated but none of its tools are gated`);
    }
  }

  await setupTestUser(channelId);
  // Start clean: a previous crashed run's fixtures would otherwise satisfy
  // this run's assertions and hide a real regression.
  await sweep(propertyId, { quiet: true });

  const ctx = { channelId, propertyId };
  const results = [];
  for (const sc of selected) {
    if (sc.dependsOn) {
      const dep = results.find((r) => r.id === sc.dependsOn);
      if (dep && !dep.passed) {
        console.log(`SKIP  ${sc.id}  — depends on ${sc.dependsOn}, which failed`);
        results.push({ id: sc.id, passed: false, skipped: true, reason: "dependency failed" });
        continue;
      }
    }
    process.stdout.write(`…     ${sc.id}`);
    const started = Date.now();
    await resetChannelSession(channelId);
    let res;
    try {
      res = sc.kind === "knowledge" ? await runKnowledge(sc, ctx) : await runAction(sc, ctx);
    } catch (err) {
      res = { passed: false, reason: `threw: ${err.message}` };
    }
    const secs = Math.round((Date.now() - started) / 1000);
    const tag = res.passed ? (res.warn ? "WARN" : "PASS") : "FAIL";
    process.stdout.write(`\r${tag}  ${sc.id}  (${secs}s)\n`);
    if (res.warn) console.log(`      ⚠ ${res.warn}`);
    if (!res.passed) console.log(`      ${res.reason}`);
    if (res.detail) console.log(`      ${res.detail}`);
    if (res.excerpt) console.log(`      bot: "${res.excerpt}…"`);
    results.push({ id: sc.id, ...res });
  }

  if (!flag("--keep")) {
    console.log("\nCleaning up…");
    // Scenario-specific teardown first (e.g. brain pages, which the row
    // sweep cannot see), then the marker sweep.
    for (const sc of selected) {
      if (typeof sc.cleanupExtra === "function") {
        await sc.cleanupExtra(ctx).catch(() => {});
      }
    }
    await sweep(propertyId);
  } else {
    console.log(`\n--keep: ${MARK} fixtures left in place (sweep later with --sweep)`);
  }

  const failed = results.filter((r) => !r.passed);
  const warned = results.filter((r) => r.passed && r.warn);
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      (warned.length ? `, ${warned.length} with warnings` : ""),
  );
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ✗ ${f.id}: ${f.reason}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
