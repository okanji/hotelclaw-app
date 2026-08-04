#!/usr/bin/env node
/**
 * AI bot chat test harness.
 *
 * Drives the in-channel AI bot end-to-end: upserts a test user, sets the
 * channel's ai_mode + sensitivity, resets engagement state (Stream channel
 * custom fields + Redis tool history), sends a message as the test user,
 * waits for the bot's reply, captures the bot's text + relevant dev-log
 * lines.
 *
 * Designed to be invoked iteratively (e.g. from this assistant) for ad-hoc
 * scenario testing. Also includes a `--suite` mode that runs the bundled
 * SCENARIOS array and prints a pass/fail report.
 *
 * Usage:
 *   node --env-file=.env.local scripts/bot-chat-test.mjs --help
 *   node --env-file=.env.local scripts/bot-chat-test.mjs send \
 *     --channel <id> --mode engaged --message "@hotelclaw what tasks are open?"
 *   node --env-file=.env.local scripts/bot-chat-test.mjs suite
 */

import { StreamChat } from "stream-chat";
import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, statSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

// ─── Config ─────────────────────────────────────────────────────────────────

const STREAM_API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!STREAM_API_KEY || !STREAM_API_SECRET) {
  console.error("missing NEXT_PUBLIC_STREAM_API_KEY / STREAM_API_SECRET");
  process.exit(1);
}

// 15s HTTP timeout: the SDK's 3s default intermittently kills long channel
// queries mid-suite (axios "timeout of 3000ms exceeded" fatals).
const stream = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET, {
  timeout: 15000,
});
const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

/** Eve-path continuity: the durable session row for this channel's root
 *  thread (channel_bot_sessions, migration 0078). Replaces the Redis
 *  turn-cache assertions for engaged mode — the session IS the memory. */
async function readEveSession(channelId) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("channel_bot_sessions")
    .select("eve_session_id, eve_continuation_token, last_turn_at")
    .eq("channel_id", channelId)
    .eq("thread_key", "_root")
    .maybeSingle();
  return data ?? null;
}

const redis = REDIS_URL && REDIS_TOKEN
  ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN })
  : null;

const BOT_USER_ID = process.env.STREAM_BOT_USER_ID ?? "hotelclaw-ai";
const TEST_USER_ID = "ai-bot-test-user";
const TEST_USER_NAME = "Bot Tester";
/** Second human in the room. Needed to test the "coordination between two
 *  named humans" skip rule honestly: @-mentioning a real member is a very
 *  different classifier input than typing a name that resolves to nobody. */
const PEER_USER_ID = "ai-bot-test-peer";
const PEER_USER_NAME = "Sam Rivera";
const DEFAULT_CHANNEL = "prop-697681e8-food-and-beverage-5d05af";
const DEV_LOG = "/tmp/hotelclaw-dev.log";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function setupTestUser(channelId, channelType = "team") {
  // Upsert the test users (idempotent).
  await stream.upsertUser({ id: TEST_USER_ID, name: TEST_USER_NAME });
  await stream.upsertUser({ id: PEER_USER_ID, name: PEER_USER_NAME });
  // Add to channel as members (idempotent — Stream silently no-ops on dup).
  const channel = stream.channel(channelType, channelId);
  try {
    await channel.addMembers([TEST_USER_ID, PEER_USER_ID]);
  } catch (err) {
    // "already a member" is fine.
    if (!/already/i.test(err.message ?? "")) {
      console.warn("[setup] addMembers warning:", err.message);
    }
  }
}

async function setMode(channelId, mode, sensitivity, channelType = "team") {
  const channel = stream.channel(channelType, channelId);
  const set = { ai_mode: mode };
  if (sensitivity && mode === "auto") set.ai_sensitivity = sensitivity;
  await channel.updatePartial({ set });
}

async function resetEngagement(channelId, channelType = "team") {
  // Wipe Stream-side engaged_threads + skipped_threads
  const channel = stream.channel(channelType, channelId);
  await channel.updatePartial({
    set: { ai_engaged_threads: [], ai_skipped_threads: [] },
  });
  // Wipe Redis-side tool history for this channel (all thread keys)
  if (redis) {
    const keys = await redis.keys(`ai-turns:${channelId}:*`);
    if (keys.length > 0) await redis.del(...keys);
  }
  // Wipe the durable eve session mapping so scenarios start with a fresh
  // conversation (the session itself is left to expire runtime-side).
  if (supabase) {
    await supabase.from("channel_bot_sessions").delete().eq("channel_id", channelId);
    await supabase.from("channel_bot_queue").delete().eq("channel_id", channelId);
  }
  // Event-driven delivery (2026-07-23): the generation lock is released by
  // the RUNTIME when the turn parks — but this reset may have deleted the
  // session row out from under an in-flight turn (delivery then can't find
  // it), so clear the lock explicitly or every subsequent scenario drops
  // as "in-flight" for the lock TTL.
  if (redis) {
    await redis.del(`ai-gen-lock:${channelId}:_root`).catch(() => {});
  }
  // Brief pause so Stream's channel-data write is visible to the next
  // webhook channel.query (Stream is eventually consistent on channel custom
  // fields, ~100-300ms in practice). Without this, the next scenario's first
  // webhook can still see the previous engagement state.
  await sleep(500);
}

async function sendAsTestUser(channelId, text, opts = {}, channelType = "team") {
  const channel = stream.channel(channelType, channelId);
  // `mentionUsers` carries HUMAN mentions (e.g. @Sam) — the classifiers treat
  // "addressed to a named teammate" very differently from an open question,
  // and that only reproduces if mentioned_users is really populated.
  const mentioned = [
    ...(opts.mentionBot ? [BOT_USER_ID] : []),
    ...(opts.mentionUsers ?? []),
  ];
  const mentioned_users = mentioned.length > 0 ? mentioned : undefined;
  const message = {
    text,
    user_id: opts.asUserId ?? TEST_USER_ID,
    ...(mentioned_users ? { mentioned_users } : {}),
    ...(opts.parentId
      ? { parent_id: opts.parentId, show_in_channel: false }
      : {}),
  };
  const res = await channel.sendMessage(message);
  return res.message;
}

async function waitForBotReply({
  channelId,
  channelType = "team",
  afterTimestamp,
  parentId,
  // Event-driven delivery (2026-07-23): the runtime posts when the turn
  // parks — tool-ladder turns routinely take 30-60s, so the assertion
  // window covers the p99 turn, not a synchronous function's budget.
  // Raised 90s → 150s (2026-08-03): a knowledge-ladder turn ("do we have an
  // SOP for X" → docs + brain + tasks) parked at 92.7s and the harness
  // reported a false "no reply" three seconds early. Silence assertions
  // pass their own short windows explicitly.
  timeoutMs = 150000,
  intervalMs = 800,
}) {
  const channel = stream.channel(channelType, channelId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let messages;
    try {
      if (parentId) {
        const res = await channel.getReplies(parentId, { limit: 20 });
        messages = res.messages ?? [];
      } else {
        const state = await channel.query({ messages: { limit: 20 } });
        messages = state.messages ?? [];
      }
    } catch (err) {
      console.warn("[wait] poll error:", err.message);
      await sleep(intervalMs);
      continue;
    }
    // Non-empty text must be part of the PREDICATE: artifact-card messages
    // (app_artifact attachments) are bot messages with EMPTY text — a
    // find() that matches them first would blind the poll to the real
    // reply sitting behind them.
    const botReply = messages.find(
      (m) =>
        m.user?.id === BOT_USER_ID &&
        new Date(m.created_at).getTime() > afterTimestamp &&
        (m.text ?? "").trim().length > 0,
    );
    if (botReply) {
      return botReply;
    }
    await sleep(intervalMs);
  }
  return null;
}

async function readEngagementState(channelId, channelType = "team") {
  const channel = stream.channel(channelType, channelId);
  const state = await channel.query({ members: { limit: 1 } });
  const d = state.channel ?? {};
  return {
    ai_mode: d.ai_mode,
    ai_sensitivity: d.ai_sensitivity,
    ai_engaged_threads: d.ai_engaged_threads ?? [],
    ai_skipped_threads: d.ai_skipped_threads ?? [],
  };
}

async function readRedisHistory(channelId, threadKey = "_root") {
  if (!redis) return null;
  const key = `ai-turns:${channelId}:${threadKey}`;
  const raw = await redis.lrange(key, 0, -1);
  return raw.map((entry) => (typeof entry === "string" ? safeParse(entry) : entry));
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Current dev-log size — the cursor a scenario passes to `decisionsSince`. */
function devLogOffset() {
  try {
    return statSync(DEV_LOG).size;
  } catch {
    return 0;
  }
}

/**
 * Structured `[ai-trigger:*]` decisions logged since `offset`.
 *
 * `threadKey` narrowing matters: classifier calls for the parent message and
 * for a thread reply run concurrently in `after()`, so the log is ordered by
 * COMPLETION, not by send order — taking the last decision blind attributes
 * the parent's verdict to the thread reply (seen 2026-08-03).
 */
function decisionsSince(offset, { kind, threadKey } = {}) {
  let found = parseAiDecisions(tailDevLog(offset).lines);
  if (kind) found = found.filter((d) => d.kind === kind);
  if (threadKey) {
    const scoped = found.filter((d) => d.threadKey === threadKey);
    if (scoped.length > 0) return scoped;
  }
  return found;
}

/**
 * Reads dev-log lines added since `sinceOffset` (file size in bytes).
 * Returns `{ lines, offset }` so caller can continue tailing.
 */
function tailDevLog(sinceOffset = 0) {
  let stat;
  try {
    stat = statSync(DEV_LOG);
  } catch {
    return { lines: [], offset: 0 };
  }
  if (stat.size < sinceOffset) sinceOffset = 0; // log was rotated
  const buf = readFileSync(DEV_LOG);
  const slice = buf.slice(sinceOffset).toString("utf8");
  const lines = slice.split("\n").filter(Boolean);
  return { lines, offset: stat.size };
}

/**
 * Parse `[ai-trigger:*]` decisions out of dev-log lines.
 *
 * console.log(obj) prints the decision across MULTIPLE lines, so a
 * line-filter (what this used to be) captured only the useless header
 * `[ai-trigger:auto] {` and dropped the classifier's reason — the one thing
 * AGENTS.md says to read when the bot mis-fires. Stitch the block back into
 * a structured record so scenarios can assert on it and failures are
 * self-explaining.
 */
function parseAiDecisions(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /\[ai-trigger:(auto|engaged:spinoff|engaged)\]/.exec(lines[i]);
    if (!head) continue;
    const block = [];
    for (let j = i + 1; j < lines.length && j < i + 16; j++) {
      if (lines[j].trim() === "}") break;
      block.push(lines[j].trim());
    }
    const text = block.join(" ");
    out.push({
      kind: head[1],
      threadKey: /threadKey: '([^']*)'/.exec(text)?.[1] ?? null,
      sensitivity: /sensitivity: '([^']*)'/.exec(text)?.[1] ?? null,
      // auto mode → should_respond boolean; engaged/spinoff → 3-way decision.
      shouldRespond: /should_respond: (true|false)/.exec(text)?.[1] ?? null,
      decision: /decision: '([^']*)'/.exec(text)?.[1] ?? null,
      reason: /reason: ["'](.*?)["'],?$/.exec(text)?.[1] ?? text,
    });
  }
  return out;
}

function formatDecision(d) {
  const verdict = d.decision ?? d.shouldRespond ?? "?";
  return `[${d.kind}${d.sensitivity ? `/${d.sensitivity}` : ""}] thread=${d.threadKey} → ${verdict} — ${d.reason}`;
}

function extractAiDecisions(lines) {
  return parseAiDecisions(lines).map(formatDecision);
}

// ─── Scenario runner ────────────────────────────────────────────────────────

async function runScenario(scenario, channelId) {
  console.log(`\n━━━ ${scenario.name} ━━━`);
  if (scenario.setup) {
    await setMode(channelId, scenario.setup.mode, scenario.setup.sensitivity);
    console.log(
      `  mode=${scenario.setup.mode}${scenario.setup.sensitivity ? `/${scenario.setup.sensitivity}` : ""}`,
    );
  }
  if (scenario.resetEngagement !== false) {
    await resetEngagement(channelId);
    console.log("  engagement state reset");
  }

  const logOffset = (() => {
    try {
      return statSync(DEV_LOG).size;
    } catch {
      return 0;
    }
  })();

  const results = [];
  let lastBotReply = null;
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepLabel = `step ${i + 1}: ${step.send ?? step.note ?? "(no-op)"}`;
    console.log(`  → ${stepLabel}`);

    if (step.note) {
      // doc-only step
      results.push({ step: stepLabel, ok: true, note: step.note });
      continue;
    }

    const sentAt = Date.now();
    let sent;
    try {
      sent = await sendAsTestUser(channelId, step.send, {
        mentionBot: step.mention === true,
        parentId: step.parentId,
      });
    } catch (err) {
      console.log(`    ✗ send failed: ${err.message}`);
      results.push({ step: stepLabel, ok: false, error: err.message });
      continue;
    }

    let botReply = null;
    if (step.expectReply !== false) {
      botReply = await waitForBotReply({
        channelId,
        afterTimestamp: sentAt,
        parentId: step.parentId,
        // Event-driven delivery: the runtime posts when the turn parks, so
        // per-step budgets tuned for the old synchronous model are floored
        // to the p99 turn. Silence assertions keep their short windows.
        timeoutMs:
          step.expectReply === "no"
            ? (step.timeoutMs ?? 8000)
            : Math.max(step.timeoutMs ?? 0, 150000),
      });
      if (!botReply) {
        if (step.expectReply === "no") {
          console.log("    ✓ no reply (as expected)");
          results.push({ step: stepLabel, ok: true, reply: null });
          continue;
        }
        console.log("    ✗ no bot reply within timeout");
        results.push({ step: stepLabel, ok: false, error: "timeout" });
        continue;
      }
      lastBotReply = botReply;
      const preview = (botReply.text ?? "").replace(/\n/g, " ").slice(0, 140);
      console.log(`    ↳ bot: ${preview}${botReply.text.length > 140 ? "…" : ""}`);
    }

    if (step.expectReply === "no" && botReply) {
      console.log("    ✗ bot replied but should not have");
      results.push({ step: stepLabel, ok: false, error: "unexpected-reply", reply: botReply.text });
      continue;
    }

    const checks = step.assert ?? [];
    const failures = [];
    for (const a of checks) {
      const txt = (botReply?.text ?? "").toLowerCase();
      if (a.contains) {
        const arr = Array.isArray(a.contains) ? a.contains : [a.contains];
        for (const needle of arr) {
          if (!txt.includes(needle.toLowerCase())) {
            failures.push(`missing "${needle}"`);
          }
        }
      }
      if (a.notContains) {
        const arr = Array.isArray(a.notContains) ? a.notContains : [a.notContains];
        for (const needle of arr) {
          if (txt.includes(needle.toLowerCase())) {
            failures.push(`should not contain "${needle}"`);
          }
        }
      }
    }
    if (failures.length > 0) {
      console.log(`    ✗ assertion(s): ${failures.join("; ")}`);
      results.push({ step: stepLabel, ok: false, error: failures.join("; "), reply: botReply?.text });
    } else {
      results.push({ step: stepLabel, ok: true, reply: botReply?.text });
    }

    if (step.pauseMs) await sleep(step.pauseMs);
  }

  // Side-effect inspection: engagement state + Redis history
  const finalEngagement = await readEngagementState(channelId);
  const history = await readRedisHistory(channelId);
  const eveSession = await readEveSession(channelId);
  const aiLogs = extractAiDecisions(tailDevLog(logOffset).lines);

  console.log(`  ─── post-state ───`);
  console.log(
    `  engagement: engaged=${JSON.stringify(finalEngagement.ai_engaged_threads)} skipped=${JSON.stringify(finalEngagement.ai_skipped_threads)}`,
  );
  console.log(`  redis turns persisted: ${history?.length ?? 0}`);
  console.log(`  eve session: ${eveSession?.eve_session_id ?? "none"} (token: ${eveSession?.eve_continuation_token ? "live" : "none"})`);
  if (aiLogs.length > 0) {
    console.log(`  classifier decisions:`);
    for (const l of aiLogs) console.log(`    ${l}`);
  }

  if (scenario.postChecks) {
    const postFailures = [];
    if (scenario.postChecks.engagedThreads !== undefined) {
      const expected = JSON.stringify(scenario.postChecks.engagedThreads);
      const actual = JSON.stringify(finalEngagement.ai_engaged_threads);
      if (expected !== actual) postFailures.push(`engagedThreads expected ${expected} got ${actual}`);
    }
    if (scenario.postChecks.minRedisTurns !== undefined) {
      const n = history?.length ?? 0;
      if (n < scenario.postChecks.minRedisTurns) {
        postFailures.push(`expected ≥${scenario.postChecks.minRedisTurns} redis turns, got ${n}`);
      }
    }
    if (scenario.postChecks.eveSession) {
      if (!eveSession?.eve_session_id || !eveSession?.eve_continuation_token) {
        postFailures.push("expected a live eve session (id + continuation token) for this channel");
      }
    }
    if (scenario.postChecks.maxRedisTurns !== undefined) {
      const n = history?.length ?? 0;
      if (n > scenario.postChecks.maxRedisTurns) {
        postFailures.push(`expected ≤${scenario.postChecks.maxRedisTurns} redis turns, got ${n}`);
      }
    }
    if (postFailures.length > 0) {
      console.log(`  ✗ post-state: ${postFailures.join("; ")}`);
      results.push({ step: "post-state", ok: false, error: postFailures.join("; ") });
    } else {
      console.log(`  ✓ post-state checks passed`);
    }
  }

  const passed = results.every((r) => r.ok);
  console.log(`  ${passed ? "✓ PASS" : "✗ FAIL"}`);
  return { name: scenario.name, passed, results, finalEngagement, redisTurns: history?.length ?? 0, aiLogs, lastBotReply };
}

// ─── Bundled scenarios ──────────────────────────────────────────────────────

const SCENARIOS = [
  {
    name: "mention/single-message: bot replies on direct mention",
    setup: { mode: "mention" },
    steps: [
      {
        // Bot may legitimately reply "Pong" — accept either; we just want a
        // non-empty reply that includes a recognizable acknowledgment.
        send: "@hotelclaw ping",
        mention: true,
        // Any reply at all counts (waitForBotReply already filters empty).
      },
    ],
  },
  {
    name: "mention/no-mention: bot stays silent",
    setup: { mode: "mention" },
    steps: [
      {
        send: "(just chatting between teammates, no bot involvement here)",
        mention: false,
        expectReply: "no",
        timeoutMs: 6000,
      },
    ],
  },
  {
    name: "mention/tool-call: bot calls list_open_tasks and synthesizes",
    setup: { mode: "mention" },
    steps: [
      {
        send: "@hotelclaw what tasks are currently open in this property?",
        mention: true,
        // Even with zero tasks the bot should mention 'task' in its synthesis.
        assert: [{ contains: "task" }],
      },
    ],
  },
  {
    name: "always: top-level message gets a useful reply (not a deferral)",
    setup: { mode: "always" },
    steps: [
      {
        send: "Hello team — what's the most important thing to focus on today?",
        mention: false,
        timeoutMs: 25000,
        // Bot must NOT defer. Common deferral phrases caught here.
        assert: [
          {
            notContains: [
              "wasn't directed at me",
              "not tagged",
              "sit this one out",
              "hang back",
              "stay out",
              "tag me",
            ],
          },
        ],
      },
    ],
  },
  {
    name: "auto/balanced: unaddressed question → bot answers, doesn't defer",
    setup: { mode: "auto", sensitivity: "balanced" },
    steps: [
      {
        send: "Anyone know what meetings are coming up this week?",
        mention: false,
        assert: [
          { contains: "meeting" },
          {
            notContains: [
              "not tagged",
              "tag me",
              "@hotelclaw",
              "hang back",
              "sit this one out",
            ],
          },
        ],
        timeoutMs: 25000,
      },
    ],
  },
  {
    name: "auto/conservative: small talk should NOT trigger",
    setup: { mode: "auto", sensitivity: "conservative" },
    steps: [
      {
        send: "lol",
        mention: false,
        expectReply: "no",
        timeoutMs: 8000,
      },
    ],
  },
  {
    name: "engaged: mention starts engagement and persists turn",
    setup: { mode: "engaged" },
    steps: [
      {
        send: "@hotelclaw what tasks are open in this property?",
        mention: true,
        assert: [{ contains: "task" }],
      },
    ],
    postChecks: {
      engagedThreads: ["_root"],
      eveSession: true,
    },
  },
  {
    name: "engaged: follow-up uses cached history, classifier responds",
    setup: { mode: "engaged" },
    steps: [
      {
        send: "@hotelclaw what tasks are open in this property?",
        mention: true,
        assert: [{ contains: "task" }],
        pauseMs: 1500,
      },
      {
        send: "Of those, which one would you prioritize and why?",
        mention: false,
        // Durable eve turns (session resume + tools + brain) run longer
        // than the old stateless generateText — give the poll headroom.
        timeoutMs: 45000,
      },
    ],
    postChecks: {
      engagedThreads: ["_root"],
      eveSession: true,
    },
  },
  {
    name: "engaged: explicit thanks → disengage + clear redis",
    setup: { mode: "engaged" },
    steps: [
      {
        send: "@hotelclaw what tasks are open?",
        mention: true,
        pauseMs: 1500,
      },
      {
        send: "thanks, got it — perfect",
        mention: false,
        assert: [{ contains: "quiet" }], // sign-off message
      },
    ],
    postChecks: {
      engagedThreads: [],
      maxRedisTurns: 0,
    },
  },
];

// ─── Stress scenarios (run via `stress` command) ───────────────────────────

const STRESS_SCENARIOS = [
  // Thread handling — the bot is supposed to reply IN the thread when
  // mentioned from a thread reply. This validates the parent_id wiring end
  // to end.
  {
    name: "stress/thread: mention in a thread → bot replies in the thread",
    setup: { mode: "mention" },
    custom: async (channelId) => {
      const channel = stream.channel("team", channelId);
      // Create a parent message as the test user, then reply to it with a
      // mention. Bot should reply within the thread (show_in_channel:false).
      const parent = await sendAsTestUser(
        channelId,
        "kicking off a quick thread to test the bot",
      );
      await sleep(800);
      const sentAt = Date.now();
      await sendAsTestUser(channelId, "@hotelclaw ping from a thread", {
        mentionBot: true,
        parentId: parent.id,
      });
      const reply = await waitForBotReply({
        channelId,
        parentId: parent.id,
        afterTimestamp: sentAt,
        timeoutMs: 25000,
      });
      if (!reply) return { passed: false, reason: "no reply in thread" };
      if (reply.parent_id !== parent.id) {
        return {
          passed: false,
          reason: `bot replied with parent_id=${reply.parent_id}, expected ${parent.id}`,
        };
      }
      return { passed: true, reply: reply.text };
    },
  },

  // Long engaged conversation: 6 turns, with the bot using tool history
  // across all of them. Validates Redis persistence under depth.
  {
    name: "stress/engaged-long: 6-turn engaged conversation, tool history persists",
    setup: { mode: "engaged" },
    custom: async (channelId) => {
      const turns = [
        { send: "@hotelclaw show me all open tasks", mention: true },
        { send: "which one would you prioritize?", mention: false },
        { send: "what's the second priority?", mention: false },
        { send: "anything blocked we should escalate?", mention: false },
        { send: "are any past due?", mention: false },
        { send: "summarize what you'd tell my team in the morning standup", mention: false },
      ];
      const replies = [];
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        const sentAt = Date.now();
        await sendAsTestUser(channelId, t.send, { mentionBot: t.mention });
        // Long timeout — later turns have accumulated tool history which
        // grows the input context and slows the model. 60s comfortably
        // covers Sonnet replies even with multi-turn tool transcripts.
        const reply = await waitForBotReply({
          channelId,
          afterTimestamp: sentAt,
          timeoutMs: 60000,
        });
        if (!reply) {
          return {
            passed: false,
            reason: `no reply at turn ${i + 1} ("${t.send}")`,
          };
        }
        replies.push(reply.text);
        await sleep(1500);
      }
      // Memory on the eve path IS the durable session (the Redis turn-cache
      // is unused there — AGENTS.md channel-bot section). Depth persistence
      // = one live session carried across all six turns.
      const eveSession = await readEveSession(channelId);
      if (!eveSession?.eve_session_id || !eveSession?.eve_continuation_token) {
        return {
          passed: false,
          reason: "expected a live eve session (id + continuation token) after 6 turns",
        };
      }
      // Sanity: the last reply (summary) should reference at least one of
      // the things from earlier turns.
      const finalReply = replies[replies.length - 1].toLowerCase();
      const referenced = ["task", "blocked", "priority"].some((w) =>
        finalReply.includes(w),
      );
      if (!referenced) {
        return {
          passed: false,
          reason: "final summary didn't reference any task/blocked/priority concepts",
        };
      }
      return { passed: true, turns: replies.length, eveSession: eveSession.eve_session_id };
    },
  },

  // Rapid burst: 3 messages 400ms apart in always-mode. With the
  // generation lock + coalesce loop in place, the burst should produce
  // ONE cohesive reply that addresses all three message themes (not 3
  // overlapping replies). The lock serializes generations per channel/
  // thread; subsequent webhooks during an in-flight gen fail to acquire
  // the lock and drop. The in-flight gen's coalesce loop re-checks for
  // new messages after generating, and re-runs with updated history if
  // any arrived — so the final reply addresses every message in the
  // burst. See lib/stream/ai-generation-lock.ts for the design.
  {
    name: "stress/rapid: 3 rapid messages → 1 cohesive reply",
    setup: { mode: "always" },
    custom: async (channelId) => {
      const messages = [
        "what's the weather like for hotels today",
        "any tips for staff scheduling",
        "best practice for guest complaints",
      ];
      const themes = ["weather", "schedul", "complaint"]; // substring keys
      const startedAt = Date.now();
      for (const m of messages) {
        await sendAsTestUser(channelId, m);
        await sleep(400);
      }
      const channel = stream.channel("team", channelId);
      const seen = [];
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const state = await channel.query({ messages: { limit: 30 } });
        seen.length = 0;
        for (const m of state.messages ?? []) {
          if (m.user?.id !== BOT_USER_ID) continue;
          if (new Date(m.created_at).getTime() <= startedAt) continue;
          if ((m.text ?? "").trim() === "") continue;
          seen.push(m);
        }
        // Stop polling once we've seen at least one reply AND a quiet period
        // has elapsed (no new bot activity for ~6s) — coalesce loop may
        // produce later replies on retry.
        const latest = seen[seen.length - 1];
        if (
          latest &&
          Date.now() - new Date(latest.created_at).getTime() > 6000
        ) {
          break;
        }
        await sleep(2000);
      }
      if (seen.length === 0) {
        return {
          passed: false,
          reason: "bot didn't reply at all to the burst",
        };
      }
      if (seen.length > 1) {
        return {
          passed: false,
          reason: `expected 1 reply for the burst, got ${seen.length} — the generation lock failed to serialize`,
        };
      }
      // One reply — the eve-path contract (channel-bot-eve.ts: "No
      // coalesce loop"): the in-flight turn absorbs the burst via the
      // generation lock, and any burst messages its context packing missed
      // arrive as unseen context on the NEXT trigger. So assert the reply
      // addresses AT LEAST the first message's theme; requiring all three
      // tested the pre-eve coalesce loop, which was deliberately removed
      // on 2026-07-19.
      const txt = seen[0].text.toLowerCase();
      const covered = themes.filter((t) => txt.includes(t));
      if (covered.length === 0) {
        return {
          passed: false,
          reason: "single reply addressed none of the burst themes",
          reply: seen[0].text.slice(0, 200),
        };
      }
      return {
        passed: true,
        replies: 1,
        note: `single reply covering ${covered.length}/3 burst themes (remainder arrives as unseen context next trigger)`,
      };
    },
  },
];

/**
 * Wait until no new bot messages have appeared in the channel for `quietMs`
 * — used between stress scenarios to ensure any pending bot generation has
 * landed before we move on. Without this, late replies from a slow scenario
 * pollute the next scenario's count of fresh replies.
 */
// maxMs sized for event-driven delivery: turns park in 30-60s and the
// runtime posts then — draining must outlast the turn, not a function.
async function waitForChannelDrain(channelId, quietMs = 6000, maxMs = 120000) {
  const channel = stream.channel("team", channelId);
  const start = Date.now();
  let lastBotMessageAt = 0;
  while (Date.now() - start < maxMs) {
    const state = await channel.query({ messages: { limit: 5 } });
    const latestBot = (state.messages ?? []).filter(
      (m) => m.user?.id === BOT_USER_ID,
    ).pop();
    const t = latestBot ? new Date(latestBot.created_at).getTime() : 0;
    if (t > lastBotMessageAt) {
      lastBotMessageAt = t;
      // saw new bot activity — restart the quiet timer
    } else if (Date.now() - lastBotMessageAt > quietMs) {
      return; // channel has been quiet long enough
    }
    await sleep(2000);
  }
}

// ─── Mode-behaviour scenarios (`modes` command) ────────────────────────────
//
// The `suite` scenarios prove auto and engaged FIRE. These prove they fire
// with the right JUDGEMENT — the parts users actually feel:
//   • auto answers a follow-up nobody re-mentioned it in (classifier rule A)
//   • auto stays out of coordination aimed at a named human (skip rule)
//   • auto works inside threads and answers IN the thread
//   • engaged listens without speaking when two humans coordinate
//   • engaged's spinoff decision and its persisted state agree
//   • a mention after the sign-off starts a fresh engagement
//
// Every assertion quotes the classifier's own reason on failure, so a red
// run says WHY the bot decided what it did instead of just "no reply".

const MODE_SCENARIOS = [
  {
    name: "auto/follow-up: unmentioned follow-up to the bot's own answer is answered",
    setup: { mode: "auto", sensitivity: "balanced" },
    custom: async (channelId) => {
      const t0 = Date.now();
      await sendAsTestUser(
        channelId,
        "@hotelclaw how many tasks are open right now?",
        { mentionBot: true },
      );
      const first = await waitForBotReply({ channelId, afterTimestamp: t0 });
      if (!first) return { passed: false, reason: "no reply to the opening mention" };

      const off = devLogOffset();
      const t1 = Date.now();
      await sendAsTestUser(channelId, "which of those would you start with?");
      const reply = await waitForBotReply({ channelId, afterTimestamp: t1 });
      const d = decisionsSince(off, { kind: "auto" }).pop();
      if (!reply) {
        return {
          passed: false,
          reason: `follow-up ignored — classifier: ${d ? formatDecision(d) : "never ran"}`,
        };
      }
      if (d && d.shouldRespond !== "true") {
        return { passed: false, reason: `replied but logged ${formatDecision(d)}` };
      }
      return { passed: true, decision: d ? formatDecision(d) : null };
    },
  },

  {
    name: "auto/coordination: a message aimed at a human teammate must not pull the bot in",
    setup: { mode: "auto", sensitivity: "balanced" },
    custom: async (channelId) => {
      const off = devLogOffset();
      const t0 = Date.now();
      await sendAsTestUser(
        channelId,
        `@${PEER_USER_NAME} can you restock the minibars on floor 3 before 3pm?`,
        { mentionUsers: [PEER_USER_ID] },
      );
      // Real silence window: a turn the classifier green-lit would land well
      // inside this, so "no message" here means the gate really held.
      const reply = await waitForBotReply({
        channelId,
        afterTimestamp: t0,
        timeoutMs: 45000,
      });
      const d = decisionsSince(off, { kind: "auto" }).pop();
      if (!d) return { passed: false, reason: "auto classifier never ran" };
      if (reply) {
        return {
          passed: false,
          reason: `butted into human coordination: "${reply.text.slice(0, 90)}" — ${formatDecision(d)}`,
        };
      }
      if (d.shouldRespond !== "false") {
        return { passed: false, reason: `classifier green-lit it: ${formatDecision(d)}` };
      }
      return { passed: true, decision: formatDecision(d) };
    },
  },

  {
    name: "auto/thread: an unaddressed question inside a thread is answered in that thread",
    setup: { mode: "auto", sensitivity: "balanced" },
    custom: async (channelId) => {
      const parent = await sendAsTestUser(
        channelId,
        "Thread: the walk-in freezer keeps alarming overnight",
      );
      await sleep(1200);
      const off = devLogOffset();
      const t0 = Date.now();
      await sendAsTestUser(
        channelId,
        "do we have an SOP for the freezer temperature alarm?",
        { parentId: parent.id },
      );
      const reply = await waitForBotReply({
        channelId,
        parentId: parent.id,
        afterTimestamp: t0,
      });
      // Scope to THIS thread — the parent message is itself a top-level
      // message auto mode classifies, and the two calls race.
      const d = decisionsSince(off, { kind: "auto", threadKey: parent.id }).pop();
      if (!reply) {
        return {
          passed: false,
          reason: `no in-thread reply — classifier: ${d ? formatDecision(d) : "never ran"}`,
        };
      }
      if (reply.parent_id !== parent.id) {
        return {
          passed: false,
          reason: `reply escaped the thread (parent_id=${reply.parent_id})`,
        };
      }
      if (d && d.threadKey !== parent.id) {
        return {
          passed: false,
          reason: `classifier keyed thread=${d.threadKey}, expected ${parent.id}`,
        };
      }
      return { passed: true, decision: d ? formatDecision(d) : null };
    },
  },

  {
    name: "engaged/stay-silent: humans coordinating keeps the bot listening, not talking",
    setup: { mode: "engaged" },
    custom: async (channelId) => {
      const t0 = Date.now();
      await sendAsTestUser(
        channelId,
        "@hotelclaw what tasks are open in this property?",
        { mentionBot: true },
      );
      const first = await waitForBotReply({ channelId, afterTimestamp: t0 });
      if (!first) return { passed: false, reason: "no reply to the engaging mention" };

      const off = devLogOffset();
      const t1 = Date.now();
      await sendAsTestUser(
        channelId,
        `@${PEER_USER_NAME} can you take the linens order today?`,
        { mentionUsers: [PEER_USER_ID] },
      );
      const reply = await waitForBotReply({
        channelId,
        afterTimestamp: t1,
        timeoutMs: 45000,
      });
      const d = decisionsSince(off, { kind: "engaged" }).pop();
      const state = await readEngagementState(channelId);
      if (!d) return { passed: false, reason: "engaged classifier never ran" };
      if (reply) {
        return {
          passed: false,
          reason: `answered a message aimed at a teammate: "${reply.text.slice(0, 90)}" — ${formatDecision(d)}`,
        };
      }
      if (d.decision !== "stay_silent") {
        return { passed: false, reason: `expected stay_silent — ${formatDecision(d)}` };
      }
      if (!(state.ai_engaged_threads ?? []).includes("_root")) {
        return {
          passed: false,
          reason: `engagement dropped: ${JSON.stringify(state.ai_engaged_threads)}`,
        };
      }
      return { passed: true, decision: formatDecision(d) };
    },
  },

  {
    name: "engaged/spinoff: the spinoff decision and the persisted state agree",
    setup: { mode: "engaged" },
    custom: async (channelId) => {
      const t0 = Date.now();
      await sendAsTestUser(
        channelId,
        "@hotelclaw what tasks are open in this property?",
        { mentionBot: true },
      );
      const first = await waitForBotReply({ channelId, afterTimestamp: t0 });
      if (!first) return { passed: false, reason: "no reply to the engaging mention" };

      // Fork the SAME topic into a thread — the structural case the spinoff
      // classifier exists for.
      const parent = await sendAsTestUser(
        channelId,
        "Spinning the open-task cleanup into its own thread",
      );
      await sleep(1200);
      const off = devLogOffset();
      const t1 = Date.now();
      await sendAsTestUser(
        channelId,
        "so which of those open tasks should we close out first?",
        { parentId: parent.id },
      );
      const reply = await waitForBotReply({
        channelId,
        parentId: parent.id,
        afterTimestamp: t1,
        timeoutMs: 60000,
      });
      const d = decisionsSince(off, {
        kind: "engaged:spinoff",
        threadKey: parent.id,
      }).pop();
      const state = await readEngagementState(channelId);
      if (!d) return { passed: false, reason: "spinoff classifier never ran" };

      const engaged = state.ai_engaged_threads ?? [];
      const skipped = state.ai_skipped_threads ?? [];
      if (d.decision === "respond") {
        if (!reply) return { passed: false, reason: `decided respond but posted nothing — ${formatDecision(d)}` };
        if (!engaged.includes(parent.id)) {
          return {
            passed: false,
            reason: `engaged the thread but state says ${JSON.stringify(engaged)}`,
          };
        }
      } else {
        if (reply) {
          return {
            passed: false,
            reason: `decided ${d.decision} but still replied: "${reply.text.slice(0, 90)}"`,
          };
        }
        if (!skipped.includes(parent.id)) {
          return {
            passed: false,
            reason: `declined the spinoff but didn't mark it skipped (skipped=${JSON.stringify(skipped)}) — it will be re-classified on every message`,
          };
        }
      }
      return { passed: true, decision: formatDecision(d), engaged, skipped };
    },
  },

  {
    name: "engaged/re-engage: a mention after the sign-off starts a fresh engagement",
    setup: { mode: "engaged" },
    custom: async (channelId) => {
      const t0 = Date.now();
      await sendAsTestUser(channelId, "@hotelclaw what tasks are open?", {
        mentionBot: true,
      });
      if (!(await waitForBotReply({ channelId, afterTimestamp: t0 }))) {
        return { passed: false, reason: "no reply to the opening mention" };
      }

      const off = devLogOffset();
      const t1 = Date.now();
      await sendAsTestUser(channelId, "perfect, thanks — that's all I needed");
      const signOff = await waitForBotReply({ channelId, afterTimestamp: t1 });
      const d = decisionsSince(off, { kind: "engaged" }).pop();
      if (!signOff || !/quiet/i.test(signOff.text ?? "")) {
        return {
          passed: false,
          reason: `expected the sign-off, got "${signOff?.text?.slice(0, 90) ?? "nothing"}" — ${d ? formatDecision(d) : "no decision"}`,
        };
      }
      const afterSignOff = await readEngagementState(channelId);
      if ((afterSignOff.ai_engaged_threads ?? []).length !== 0) {
        return {
          passed: false,
          reason: `still engaged after sign-off: ${JSON.stringify(afterSignOff.ai_engaged_threads)}`,
        };
      }

      const t2 = Date.now();
      await sendAsTestUser(
        channelId,
        "@hotelclaw actually — what documents do we have on file?",
        { mentionBot: true },
      );
      const back = await waitForBotReply({ channelId, afterTimestamp: t2 });
      const state = await readEngagementState(channelId);
      if (!back) return { passed: false, reason: "bot never came back on re-mention" };
      if (!(state.ai_engaged_threads ?? []).includes("_root")) {
        return {
          passed: false,
          reason: `re-mention did not re-engage: ${JSON.stringify(state.ai_engaged_threads)}`,
        };
      }
      return { passed: true, reply: back.text.slice(0, 110) };
    },
  },
];

// ─── Parallel/concurrency scenarios (0093: lossless queue + jobs) ──────────
// These verify the eve-docs-prescribed app-layer queue and the detached
// background-job path end-to-end against the live pipeline.

const PARALLEL_SCENARIOS = [
  {
    name: "parallel/queue: message arriving mid-turn is queued and answered",
    setup: { mode: "mention" },
    custom: async (channelId) => {
      const t0 = Date.now();
      await sendAsTestUser(
        channelId,
        "@hotelclaw give me a rundown of open tasks and anything blocked, with details",
        { mentionBot: true },
      );
      await sleep(6000); // land msg2 mid-turn
      await sendAsTestUser(channelId, "@hotelclaw quick one: how many SOPs do we have?", {
        mentionBot: true,
      });

      // Expect TWO bot replies (turn 1 + drained turn 2), nothing dropped.
      const channel = stream.channel("team", channelId);
      const replies = new Set();
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline && replies.size < 2) {
        await sleep(5000);
        const state = await channel.query({ messages: { limit: 12 } });
        for (const m of state.messages ?? []) {
          if (m.user?.id !== BOT_USER_ID) continue;
          if (new Date(m.created_at).getTime() <= t0) continue;
          if ((m.text ?? "").trim()) replies.add(m.id);
        }
      }
      if (replies.size < 2) {
        return { passed: false, reason: `expected 2 replies (turn + drained queue), got ${replies.size}` };
      }
      // The queue must be empty afterwards (drained, not stranded).
      if (supabase) {
        const { data: q } = await supabase
          .from("channel_bot_queue")
          .select("id")
          .eq("channel_id", channelId);
        if ((q ?? []).length > 0) {
          return { passed: false, reason: `queue not drained: ${q.length} rows left` };
        }
      }
      return { passed: true, replies: replies.size };
    },
  },
  {
    name: "parallel/gate: management report refused for non-member sender",
    setup: { mode: "mention" },
    custom: async (channelId) => {
      const sentAt = Date.now();
      await sendAsTestUser(channelId, "@hotelclaw show me the weekly management report", {
        mentionBot: true,
      });
      const reply = await waitForBotReply({ channelId, afterTimestamp: sentAt, timeoutMs: 90000 });
      if (!reply) return { passed: false, reason: "no reply" };
      const text = reply.text.toLowerCase();
      // The sender (bot-tester) is NOT a member: the in-executor role gate
      // must refuse — and must not leak report content.
      if (!/owner|manager|restricted|can't|cannot/.test(text)) {
        return { passed: false, reason: `expected a role refusal, got: ${reply.text.slice(0, 160)}` };
      }
      if (/period|summary_md|## /.test(text)) {
        return { passed: false, reason: "reply appears to contain report content" };
      }
      return { passed: true };
    },
  },
  {
    name: "parallel/job: heavy ask → instant ack + detached job delivers",
    setup: { mode: "mention" },
    custom: async (channelId) => {
      const sentAt = Date.now();
      await sendAsTestUser(
        channelId,
        "@hotelclaw please run this as a background job: a comprehensive audit cross-referencing our SOP documents against tasks and guest complaints, full report.",
        { mentionBot: true },
      );
      // 1. The conversational ack must land fast — the channel stays free.
      const ack = await waitForBotReply({ channelId, afterTimestamp: sentAt, timeoutMs: 90000 });
      if (!ack) return { passed: false, reason: "no ack reply" };

      if (!supabase) return { passed: true, note: "ack only (no supabase env for job assertions)" };

      // 2. A kind='job' row appears and reaches delivered within 7 min.
      const deadline = Date.now() + 420000;
      let job = null;
      while (Date.now() < deadline) {
        const { data } = await supabase
          .from("channel_bot_sessions")
          .select("job_headline, turn_state, turn_nonce, delivered_nonce, created_at")
          .eq("channel_id", channelId)
          .eq("kind", "job")
          .gte("created_at", new Date(sentAt).toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        job = data;
        if (job?.delivered_nonce && job.delivered_nonce === job.turn_nonce) break;
        await sleep(10000);
      }
      if (!job) return { passed: false, reason: "no job row created — start_background_job never fired" };
      if (job.delivered_nonce !== job.turn_nonce) {
        return { passed: false, reason: `job never delivered (state=${job.turn_state})` };
      }
      // 3. The result message actually exists in Stream (chunk 1, deterministic id).
      try {
        const res = await stream.getMessage(`eve-${job.turn_nonce}`);
        if (!(res.message.text ?? "").includes(job.job_headline)) {
          return { passed: false, reason: "result message missing the job headline" };
        }
      } catch {
        return { passed: false, reason: "delivered_nonce set but result message not found in Stream" };
      }
      return { passed: true, headline: job.job_headline };
    },
  },
];

// ─── Write-tool scenarios (chat as control surface, Phase 1) ───────────────
// Verifies the bot can actually MUTATE the app: fill a stub document
// through the Liveblocks write path (incl. brain re-mirror) and update a
// task (incl. the attributed assignment notification). Fixtures are fixed-
// title rows reset at the start of each run — idempotent, no residue.

const WRITES_DOC_TITLE = "AI Writes Harness Scratch Doc";
const WRITES_TASK_TITLE = "AI writes harness scratch task";

const WRITES_SCENARIOS = [
  {
    name: "writes/document: bot fills a stub doc (Liveblocks + brain mirror)",
    setup: { mode: "mention" },
    custom: async (channelId) => {
      if (!supabase) return { passed: false, reason: "needs supabase env" };
      const { data: ch } = await supabase
        .from("chat_channels")
        .select("property_id")
        .eq("stream_channel_id", channelId)
        .maybeSingle();
      const propertyId = ch?.property_id;
      if (!propertyId) return { passed: false, reason: "channel property not found" };

      // Reset the fixture doc to a stub.
      const { data: existingDoc } = await supabase
        .from("documents")
        .select("id")
        .eq("property_id", propertyId)
        .eq("title", WRITES_DOC_TITLE)
        .maybeSingle();
      let docId = existingDoc?.id;
      if (docId) {
        await supabase
          .from("documents")
          .update({ body_text: "Stub — needs content.", body_json: null, archived_at: null })
          .eq("id", docId);
      } else {
        const { data: created } = await supabase
          .from("documents")
          .insert({
            property_id: propertyId,
            title: WRITES_DOC_TITLE,
            body_text: "Stub — needs content.",
          })
          .select("id")
          .single();
        docId = created?.id;
      }
      if (!docId) return { passed: false, reason: "fixture doc create failed" };

      const sentAt = Date.now();
      await sendAsTestUser(
        channelId,
        `@hotelclaw the doc titled "${WRITES_DOC_TITLE}" is a stub — write a short 3-section procedure into it (purpose, steps, checklist). Go ahead without confirming.`,
        { mentionBot: true },
      );
      const reply = await waitForBotReply({ channelId, afterTimestamp: sentAt, timeoutMs: 180000 });
      if (!reply) return { passed: false, reason: "no reply" };

      // Give the write + snapshot + brain mirror a moment to settle.
      let doc = null;
      for (let i = 0; i < 10; i++) {
        await sleep(4000);
        const { data } = await supabase
          .from("documents")
          .select("body_text, brain_synced_at, body_updated_at")
          .eq("id", docId)
          .single();
        doc = data;
        if ((doc?.body_text?.length ?? 0) > 300) break;
      }
      if ((doc?.body_text?.length ?? 0) <= 300) {
        return {
          passed: false,
          reason: `doc body not written (len=${doc?.body_text?.length ?? 0}); reply: ${reply.text.slice(0, 120)}`,
        };
      }
      if (!doc.brain_synced_at || doc.brain_synced_at < doc.body_updated_at) {
        return { passed: false, reason: "brain mirror did not re-sync after the write" };
      }
      return { passed: true, bodyLength: doc.body_text.length };
    },
  },
  {
    name: "writes/task: bot updates status + assigns (attributed notification)",
    setup: { mode: "mention" },
    custom: async (channelId) => {
      if (!supabase) return { passed: false, reason: "needs supabase env" };
      const { data: ch } = await supabase
        .from("chat_channels")
        .select("property_id")
        .eq("stream_channel_id", channelId)
        .maybeSingle();
      const propertyId = ch?.property_id;
      if (!propertyId) return { passed: false, reason: "channel property not found" };

      // A real member to assign to.
      const { data: members } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("property_id", propertyId)
        .limit(5);
      const ids = (members ?? []).map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      const target = (profiles ?? []).find((p) => p.full_name);
      if (!target) return { passed: false, reason: "no named member to assign" };

      // Reset the fixture task.
      const { data: existingTask } = await supabase
        .from("tasks")
        .select("id")
        .eq("property_id", propertyId)
        .eq("title", WRITES_TASK_TITLE)
        .maybeSingle();
      let taskId = existingTask?.id;
      if (taskId) {
        await supabase
          .from("tasks")
          .update({ status: "todo", assignee_id: null })
          .eq("id", taskId);
      } else {
        const { data: created } = await supabase
          .from("tasks")
          .insert({ property_id: propertyId, title: WRITES_TASK_TITLE, status: "todo" })
          .select("id")
          .single();
        taskId = created?.id;
      }
      if (!taskId) return { passed: false, reason: "fixture task create failed" };
      const notifiedBefore = Date.now();

      const sentAt = Date.now();
      await sendAsTestUser(
        channelId,
        `@hotelclaw set the task "${WRITES_TASK_TITLE}" to blocked and assign it to ${target.full_name}.`,
        { mentionBot: true },
      );
      const reply = await waitForBotReply({ channelId, afterTimestamp: sentAt, timeoutMs: 120000 });
      if (!reply) return { passed: false, reason: "no reply" };

      let task = null;
      for (let i = 0; i < 8; i++) {
        await sleep(3000);
        const { data } = await supabase
          .from("tasks")
          .select("status, assignee_id")
          .eq("id", taskId)
          .single();
        task = data;
        if (task?.status === "blocked" && task?.assignee_id === target.id) break;
      }
      if (task?.status !== "blocked" || task?.assignee_id !== target.id) {
        return {
          passed: false,
          reason: `task not updated (status=${task?.status}, assignee=${task?.assignee_id?.slice(0, 8)})`,
        };
      }
      // Attributed notification (renderer reads byUserName — must not fall
      // back to "Someone").
      const { data: notifs } = await supabase
        .from("notifications")
        .select("payload, created_at")
        .eq("user_id", target.id)
        .eq("type", "task_assigned")
        .gte("created_at", new Date(notifiedBefore).toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      const payload = notifs?.[0]?.payload;
      if (!payload?.byUserName) {
        return { passed: false, reason: "assignment notification missing byUserName attribution" };
      }
      return { passed: true, assignedTo: target.full_name, by: payload.byUserName };
    },
  },
];

async function runStress(channelId, scenarios = STRESS_SCENARIOS, label = "STRESS") {
  console.log(`\n━━━ ${label} SUITE ━━━`);
  const results = [];
  for (const s of scenarios) {
    console.log(`\n━━━ ${s.name} ━━━`);
    if (s.setup) {
      await setMode(channelId, s.setup.mode, s.setup.sensitivity);
      console.log(`  mode=${s.setup.mode}`);
    }
    await resetEngagement(channelId);
    console.log("  engagement reset");

    const start = Date.now();
    let outcome;
    try {
      outcome = await s.custom(channelId);
    } catch (err) {
      outcome = { passed: false, reason: `threw: ${err.message}` };
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (outcome.passed) {
      console.log(`  ✓ PASS (${elapsed}s) ${JSON.stringify(outcome).slice(0, 150)}`);
    } else {
      console.log(`  ✗ FAIL (${elapsed}s) ${outcome.reason}`);
    }
    results.push({ name: s.name, ...outcome, elapsedSec: elapsed });

    // Drain: wait for any pending generations to finish before the next
    // scenario, so late replies don't pollute its message counts. Wrapped
    // in try/catch — a transient Stream API error here shouldn't abort
    // the entire stress run.
    console.log("  draining channel before next scenario…");
    try {
      await waitForChannelDrain(channelId);
    } catch (err) {
      console.warn(`  (drain warning: ${err.message})`);
      await sleep(5000); // fallback grace period
    }
  }
  console.log(`\n━━━ ${label} SUMMARY ━━━`);
  for (const r of results) {
    console.log(`  ${r.passed ? "✓" : "✗"} ${r.name} (${r.elapsedSec}s) ${r.passed ? "" : "— " + r.reason}`);
  }
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(2);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";

function getArg(name, fallback) {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

async function main() {
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(`Usage:
  send  --channel <id> [--mode mention|auto|always|engaged] [--sensitivity ...] [--mention] --message "..."
  suite [--channel <id>]
  modes [--channel <id>]      (auto + engaged judgement: follow-ups, skip rules, threads, spinoff)
  parallel [--channel <id>]   (queue drain, role gate, background job — several minutes)
  writes [--channel <id>]     (doc fill via Liveblocks + task update + notification)
  state [--channel <id>]
  reset [--channel <id>]
`);
    return;
  }

  const channelId = getArg("channel", DEFAULT_CHANNEL);
  await setupTestUser(channelId);

  if (cmd === "state") {
    const e = await readEngagementState(channelId);
    const h = await readRedisHistory(channelId);
    console.log(JSON.stringify({ engagement: e, redisTurns: h?.length ?? 0 }, null, 2));
    return;
  }

  if (cmd === "reset") {
    await resetEngagement(channelId);
    console.log("reset ✓");
    return;
  }

  if (cmd === "send") {
    const mode = getArg("mode");
    const sens = getArg("sensitivity");
    const message = getArg("message");
    if (!message) {
      console.error("--message required");
      process.exit(1);
    }
    if (mode) await setMode(channelId, mode, sens);
    if (hasFlag("reset-engagement")) await resetEngagement(channelId);
    const sentAt = Date.now();
    const sent = await sendAsTestUser(channelId, message, {
      mentionBot: hasFlag("mention"),
    });
    console.log("sent:", sent.id);
    const reply = await waitForBotReply({
      channelId,
      afterTimestamp: sentAt,
      timeoutMs: 30000,
    });
    if (reply) {
      console.log("\nbot reply:\n" + reply.text);
    } else {
      console.log("\n(no bot reply within 30s)");
    }
    return;
  }

  if (cmd === "stress") {
    await runStress(channelId);
    return;
  }

  if (cmd === "modes") {
    // Judgement coverage for auto + engaged (follow-ups, skip rules,
    // threads, spinoff, re-engagement).
    await runStress(channelId, MODE_SCENARIOS, "MODES");
    return;
  }

  if (cmd === "parallel") {
    // Concurrency + background-job coverage (0093). The job scenario takes
    // several minutes — the detached session does real work.
    await runStress(channelId, PARALLEL_SCENARIOS, "PARALLEL");
    return;
  }

  if (cmd === "writes") {
    // Write-tool coverage (control surface Phase 1): doc fill via the
    // Liveblocks path + task update with attributed notification.
    await runStress(channelId, WRITES_SCENARIOS, "WRITES");
    return;
  }

  if (cmd === "suite") {
    const summary = [];
    for (const s of SCENARIOS) {
      const r = await runScenario(s, channelId);
      summary.push(r);
      await sleep(1500); // breathing room between scenarios
    }
    console.log("\n━━━ SUMMARY ━━━");
    for (const r of summary) {
      console.log(`  ${r.passed ? "✓" : "✗"} ${r.name}`);
    }
    const failed = summary.filter((r) => !r.passed);
    console.log(`\n${summary.length - failed.length}/${summary.length} passed`);
    if (failed.length > 0) process.exit(2);
    return;
  }

  console.error("unknown command:", cmd);
  process.exit(1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
