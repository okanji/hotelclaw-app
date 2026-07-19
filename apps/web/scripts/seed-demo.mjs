/**
 * Comprehensive demo-data seeder for a FRESH property ("a company using the app").
 *
 *   node --env-file=.env.local scripts/seed-demo.mjs           # seed
 *   node --env-file=.env.local scripts/seed-demo.mjs --reset    # tear the demo down
 *
 * Reads the content pack at scripts/demo-content.json (produced by the
 * demo-content-pack workflow). Writes across THREE systems:
 *   - Supabase (service role): property, auth users, profiles, memberships,
 *     spaces, space_members, projects, project_spaces, labels, tasks (+subtasks),
 *     documents (metadata), meetings (+attendees), entities. Task/doc inserts
 *     auto-populate workflow_events via DB triggers (the activity feed).
 *   - Stream Chat: upserts users, creates team channels, posts message threads.
 *   - Liveblocks: writes real Tiptap bodies into each document's room, then
 *     snapshots body_state/body_text/body_json back to Postgres.
 *
 * Everything created is recorded in scripts/demo-seed.lock.json so --reset can
 * remove it precisely (incl. external Stream channels/users + Liveblocks rooms,
 * which don't cascade with the Postgres property delete).
 *
 * The real human owner (Oamar) is added as owner of the demo property and woven
 * into spaces/channels/tasks so the workspace looks alive on first login.
 */

import { createClient } from "@supabase/supabase-js";
import { StreamChat } from "stream-chat";
import { Liveblocks } from "@liveblocks/node";
import { withProsemirrorDocument } from "@liveblocks/node-prosemirror";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* ── Constants ─────────────────────────────────────────────────────────────── */

const OWNER_USER_ID = "33831554-d1a7-4f62-85a5-85952cbc11e4"; // Oamar Kanji
const DEMO_EMAIL_DOMAIN = "demo.hotelclaw.test";
const CONTENT_PATH = path.join(process.cwd(), "scripts", "demo-content.json");
const LOCK_PATH = path.join(process.cwd(), "scripts", "demo-seed.lock.json");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STREAM_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY;
const STREAM_SECRET = process.env.STREAM_API_SECRET;
const LIVEBLOCKS_SECRET = process.env.LIVEBLOCKS_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing Supabase env. Run with --env-file=.env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});
const stream =
  STREAM_KEY && STREAM_SECRET
    ? StreamChat.getInstance(STREAM_KEY, STREAM_SECRET, { timeout: 20000 })
    : null;
const liveblocks = LIVEBLOCKS_SECRET
  ? new Liveblocks({ secret: LIVEBLOCKS_SECRET })
  : null;

/* ── Helpers ───────────────────────────────────────────────────────────────── */

const uuid = () => crypto.randomUUID();
const now = () => new Date();
const dayMs = 86_400_000;
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const isoIn = (days, hour = 9, minute = 0) => {
  const d = now();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const NONE_DATE = 9999;
const roomIdForDocument = (propertyId, documentId) =>
  `property:${propertyId}:doc:${documentId}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry a flaky network call (Liveblocks rate-limits bursts) with backoff. */
async function retry(fn, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Build a ProseMirror JSON doc from the block model. node-prosemirror's
 * `setContent(string)` inserts a string as LITERAL TEXT (it does not parse
 * HTML), so we must hand it a ProseMirror node tree. The default schema is
 * Tiptap StarterKit + Liveblocks marks: heading/paragraph/bulletList/
 * orderedList/listItem/blockquote/horizontalRule/text. (No taskList/callout —
 * todos render as a bullet list with a ☐ glyph, callouts as a blockquote.)
 */
const txt = (s) => {
  const v = String(s ?? "").trim();
  return v ? [{ type: "text", text: v }] : [];
};
const para = (s) => ({ type: "paragraph", content: txt(s) });
const listItems = (items, prefix = "") =>
  (items ?? [])
    .filter((i) => String(i ?? "").trim())
    .map((i) => ({ type: "listItem", content: [para(prefix + i)] }));

function blocksToDoc(blocks) {
  const content = [];
  for (const b of blocks ?? []) {
    const t = b.type;
    if (t === "h1" || t === "h2" || t === "h3") {
      content.push({
        type: "heading",
        attrs: { level: t === "h1" ? 1 : t === "h2" ? 2 : 3 },
        content: txt(b.text),
      });
    } else if (t === "p") {
      content.push(para(b.text));
    } else if (t === "quote") {
      content.push({ type: "blockquote", content: [para(b.text)] });
    } else if (t === "callout") {
      content.push({ type: "blockquote", content: [para(`💡 ${b.text}`)] });
    } else if (t === "bullets") {
      const items = listItems(b.items);
      if (items.length) content.push({ type: "bulletList", content: items });
    } else if (t === "numbers") {
      const items = listItems(b.items);
      if (items.length) content.push({ type: "orderedList", content: items });
    } else if (t === "todo") {
      const items = listItems(b.items, "☐ ");
      if (items.length) content.push({ type: "bulletList", content: items });
    } else if (t === "divider") {
      content.push({ type: "horizontalRule" });
    } else if (b.text) {
      content.push(para(b.text));
    }
  }
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

/** Write a Tiptap body into a doc's Liveblocks room + snapshot it to Postgres. */
async function writeDocBody(rec) {
  const doc = blocksToDoc(rec.blocks);
  await retry(() =>
    liveblocks.getOrCreateRoom(rec.roomId, { defaultAccesses: [] }),
  );
  await retry(() =>
    withProsemirrorDocument(
      { client: liveblocks, roomId: rec.roomId },
      async (api) => {
        await api.setContent(doc);
      },
    ),
  );
  const buf = await retry(() =>
    liveblocks.getYjsDocumentAsBinaryUpdate(rec.roomId),
  );
  const derived = await retry(() =>
    withProsemirrorDocument({ client: liveblocks, roomId: rec.roomId }, (api) => ({
      bodyText: api.getText({ blockSeparator: "\n" }),
      bodyJson: api.toJSON(),
    })),
  );
  await sb
    .from("documents")
    .update({
      body_state: Buffer.from(new Uint8Array(buf)),
      body_text: derived.bodyText,
      body_json: derived.bodyJson,
      body_updated_at: new Date().toISOString(),
    })
    .eq("id", rec.id);
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  } catch {
    return null;
  }
}
function writeLock(lock) {
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
}

/* ── Reset ─────────────────────────────────────────────────────────────────── */

async function reset() {
  const lock = readLock();
  if (!lock) {
    console.log("No demo-seed.lock.json found — nothing to reset.");
    return;
  }
  console.log(`Resetting demo property ${lock.propertyId}…`);

  // 1. Liveblocks rooms (don't cascade with property delete).
  if (liveblocks && lock.roomIds?.length) {
    for (const roomId of lock.roomIds) {
      try {
        await liveblocks.deleteRoom(roomId);
      } catch (e) {
        console.warn(`  liveblocks deleteRoom ${roomId}: ${e.message}`);
      }
    }
    console.log(`  Deleted ${lock.roomIds.length} Liveblocks rooms`);
  }

  // 2. Stream channels + users.
  if (stream && lock.streamChannelIds?.length) {
    for (const id of lock.streamChannelIds) {
      try {
        await stream.channel("team", id).delete();
      } catch (e) {
        console.warn(`  stream channel delete ${id}: ${e.message}`);
      }
    }
    console.log(`  Deleted ${lock.streamChannelIds.length} Stream channels`);
  }
  if (stream && lock.userIds?.length) {
    try {
      await stream.deleteUsers(lock.userIds, {
        user: "hard",
        messages: "hard",
        conversations: "hard",
      });
      console.log(`  Deleted ${lock.userIds.length} Stream users`);
    } catch (e) {
      console.warn(`  stream deleteUsers: ${e.message}`);
    }
  }

  // 3. Supabase property → cascades spaces/projects/tasks/documents/channels/etc.
  const { error: delErr } = await sb
    .from("properties")
    .delete()
    .eq("id", lock.propertyId);
  if (delErr) console.warn(`  property delete: ${delErr.message}`);
  else console.log("  Deleted property (cascaded all Postgres rows)");

  // 4. Demo auth users (never the real owner).
  for (const id of lock.userIds ?? []) {
    if (id === OWNER_USER_ID) continue;
    try {
      await sb.auth.admin.deleteUser(id);
    } catch (e) {
      console.warn(`  deleteUser ${id}: ${e.message}`);
    }
  }
  console.log("  Deleted demo auth users");

  fs.rmSync(LOCK_PATH, { force: true });
  console.log("Reset complete.");
}

/* ── Seed ──────────────────────────────────────────────────────────────────── */

async function seed() {
  if (readLock()) {
    console.error(
      "demo-seed.lock.json exists — a demo is already seeded. Run with --reset first.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(CONTENT_PATH)) {
    console.error(`Missing ${CONTENT_PATH}. Run the demo-content-pack workflow first.`);
    process.exit(1);
  }
  const content = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf8"));
  const { bible, tasks, docs, threads, meetings } = content;

  const lock = {
    propertyId: null,
    userIds: [OWNER_USER_ID],
    streamChannelIds: [],
    roomIds: [],
    createdAt: new Date().toISOString(),
  };

  let position = 1000;
  const nextPos = () => (position += 1000);

  /* 1. Property */
  const propertyId = uuid();
  lock.propertyId = propertyId;
  const propName = bible.company.name;
  {
    const { error } = await sb.from("properties").insert({
      id: propertyId,
      name: propName,
      slug: `${slugify(propName)}-demo-${propertyId.slice(0, 6)}`,
    });
    if (error) throw new Error(`property: ${error.message}`);
  }
  // Persist the lock immediately so a mid-run failure is still cleanable.
  writeLock(lock);
  console.log(`✓ Property "${propName}" (${propertyId})`);
  console.log(
    "  ℹ run `node --env-file=.env.local scripts/provision-property-brain.mjs --all` to bind it to the knowledge brain",
  );

  /* 2. Owner membership (real user) */
  await sb
    .from("memberships")
    .upsert(
      { property_id: propertyId, user_id: OWNER_USER_ID, role: "owner" },
      { onConflict: "property_id,user_id" },
    );

  /* 3. Fake teammates → auth user + profile + membership. Map personaKey → uuid. */
  const personByKey = new Map(); // key -> { id, fullName, avatarUrl, role }
  for (const p of bible.personas) {
    const email = `${slugify(p.firstName)}.${p.key.split("-").pop()}@${DEMO_EMAIL_DOMAIN}`;
    const avatarUrl = `https://i.pravatar.cc/240?u=${encodeURIComponent(email)}`;
    let userId;
    try {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomBytes(16).toString("hex"),
        user_metadata: { full_name: p.fullName, demo: true },
      });
      if (error) throw error;
      userId = data.user.id;
    } catch (e) {
      console.warn(`  createUser ${email}: ${e.message} — skipping persona ${p.key}`);
      continue;
    }
    lock.userIds.push(userId);
    await sb.from("profiles").upsert({
      id: userId,
      full_name: p.fullName,
      avatar_url: avatarUrl,
      onboarded_at: new Date().toISOString(),
      time_format: "24h",
    });
    await sb.from("memberships").upsert(
      { property_id: propertyId, user_id: userId, role: p.role },
      { onConflict: "property_id,user_id" },
    );
    personByKey.set(p.key, {
      id: userId,
      fullName: p.fullName,
      avatarUrl,
      role: p.role,
    });
  }
  console.log(`✓ ${personByKey.size} teammates (auth + profile + membership)`);
  writeLock(lock);

  const personId = (key) => personByKey.get(key)?.id ?? null;

  /* 4. Spaces + space_members. Map spaceKey → id. */
  const spaceByKey = new Map();
  for (const s of bible.spaces) {
    const id = uuid();
    spaceByKey.set(s.key, id);
    const { error } = await sb.from("spaces").insert({
      id,
      property_id: propertyId,
      name: s.name,
      color: s.color,
      icon: s.icon ?? null,
      position: nextPos(),
      created_by: OWNER_USER_ID,
    });
    if (error) throw new Error(`space ${s.key}: ${error.message}`);
    const memberIds = new Set();
    for (const mk of s.memberKeys ?? []) {
      const mid = personId(mk);
      if (mid) memberIds.add(mid);
    }
    // Put the owner in the first two spaces so the user sees themselves.
    if (spaceByKey.size <= 2) memberIds.add(OWNER_USER_ID);
    if (memberIds.size) {
      const { error: smErr } = await sb.from("space_members").insert(
        [...memberIds].map((user_id) => ({ space_id: id, user_id })),
      );
      if (smErr) console.warn(`  space_members ${s.key}: ${smErr.message}`);
    }
  }
  console.log(`✓ ${spaceByKey.size} spaces (+ members)`);

  /* 5. Projects + project_spaces. Map projectKey → id. */
  const projectByKey = new Map();
  for (const p of bible.projects) {
    const id = uuid();
    projectByKey.set(p.key, id);
    const { error } = await sb.from("projects").insert({
      id,
      property_id: propertyId,
      name: p.name,
      description: p.description ?? null,
      color: p.color,
      icon: p.icon ?? null,
      status: p.status,
      start_date: Number.isFinite(p.startInDays)
        ? isoIn(p.startInDays).slice(0, 10)
        : null,
      target_date: Number.isFinite(p.targetInDays)
        ? isoIn(p.targetInDays).slice(0, 10)
        : null,
      position: nextPos(),
      created_by: personId(p.leadKey) ?? OWNER_USER_ID,
    });
    if (error) throw new Error(`project ${p.key}: ${error.message}`);
    const spaceLinks = (p.spaceKeys ?? [])
      .map((sk) => spaceByKey.get(sk))
      .filter(Boolean)
      .map((space_id) => ({ project_id: id, space_id }));
    if (spaceLinks.length) await sb.from("project_spaces").insert(spaceLinks);
  }
  console.log(`✓ ${projectByKey.size} projects (+ space links)`);

  /* 6. Labels catalog. */
  const labelRows = (bible.labels ?? []).map((l) => ({
    property_id: propertyId,
    name: l.name,
    color: l.color,
    created_by: OWNER_USER_ID,
  }));
  if (labelRows.length) {
    const { error } = await sb.from("labels").insert(labelRows);
    if (error) console.warn(`  labels: ${error.message}`);
  }
  console.log(`✓ ${labelRows.length} labels`);

  /* 7. Tasks (+ subtasks). Inserts auto-emit task.created activity events. */
  let taskCount = 0;
  let subtaskCount = 0;
  for (const t of tasks ?? []) {
    const id = uuid();
    const due =
      Number.isFinite(t.dueInDays) && t.dueInDays !== NONE_DATE
        ? isoIn(t.dueInDays, 17)
        : null;
    const schedStart =
      Number.isFinite(t.scheduledStartInDays) &&
      t.scheduledStartInDays !== NONE_DATE
        ? isoIn(t.scheduledStartInDays, 9)
        : null;
    const schedEnd =
      schedStart && t.scheduledDurationHours
        ? new Date(
            new Date(schedStart).getTime() + t.scheduledDurationHours * 3600_000,
          ).toISOString()
        : null;
    const { error } = await sb.from("tasks").insert({
      id,
      property_id: propertyId,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      priority: t.priority,
      assignee_id: personId(t.assigneeKey),
      created_by: personId(t.createdByKey) ?? OWNER_USER_ID,
      due_at: due,
      scheduled_start: schedStart,
      scheduled_end: schedEnd,
      position: nextPos(),
      labels: Array.isArray(t.labels) ? t.labels : [],
      space_id: spaceByKey.get(t.spaceKey) ?? null,
      project_id: projectByKey.get(t.projectKey) ?? null,
    });
    if (error) {
      console.warn(`  task "${t.title}": ${error.message}`);
      continue;
    }
    taskCount++;
    for (const sub of t.subtasks ?? []) {
      const { error: subErr } = await sb.from("tasks").insert({
        property_id: propertyId,
        title: sub,
        status: t.status === "done" ? "done" : "todo",
        priority: "none",
        assignee_id: personId(t.assigneeKey),
        created_by: personId(t.createdByKey) ?? OWNER_USER_ID,
        parent_id: id,
        position: nextPos(),
        space_id: spaceByKey.get(t.spaceKey) ?? null,
        project_id: projectByKey.get(t.projectKey) ?? null,
      });
      if (!subErr) subtaskCount++;
    }
  }
  console.log(`✓ ${taskCount} tasks + ${subtaskCount} subtasks (activity feed auto-populated)`);

  /* 8. Documents (metadata) → then Liveblocks bodies. Map to {id, roomId, blocks}. */
  const docRecords = [];
  for (const d of docs ?? []) {
    const id = uuid();
    const creator = personId(d.createdByKey) ?? OWNER_USER_ID;
    const { error } = await sb.from("documents").insert({
      id,
      property_id: propertyId,
      title: d.title,
      icon: d.icon ?? null,
      kind: "doc",
      position: nextPos(),
      space_id: spaceByKey.get(d.spaceKey) ?? null,
      project_id: projectByKey.get(d.projectKey) ?? null,
      created_by: creator,
      last_edited_by: creator,
    });
    if (error) {
      console.warn(`  doc "${d.title}": ${error.message}`);
      continue;
    }
    docRecords.push({ id, roomId: roomIdForDocument(propertyId, id), blocks: d.blocks });
    lock.roomIds.push(roomIdForDocument(propertyId, id));
  }
  console.log(`✓ ${docRecords.length} documents (metadata)`);
  writeLock(lock);


  /* 8b. Liveblocks bodies + snapshot back to Postgres. Best-effort, sequential. */
  if (liveblocks) {
    let bodyCount = 0;
    for (const rec of docRecords) {
      try {
        await writeDocBody(rec);
        bodyCount++;
      } catch (e) {
        console.warn(`  doc body ${rec.id}: ${e.message}`);
      }
    }
    console.log(`✓ ${bodyCount}/${docRecords.length} document bodies written to Liveblocks`);
  } else {
    console.log("  (skipping Liveblocks bodies — LIVEBLOCKS_SECRET_KEY unset)");
  }

  /* 9. Stream: upsert users, create channels, post threads. */
  const channelByKey = new Map(); // key -> { streamId, dbId }
  if (stream) {
    // Upsert every member (incl. owner) as a Stream user.
    const streamUsers = [
      { id: OWNER_USER_ID, name: "Oamar Kanji" },
      ...[...personByKey.values()].map((p) => ({
        id: p.id,
        name: p.fullName,
        image: p.avatarUrl,
      })),
    ];
    try {
      await stream.upsertUsers(streamUsers);
    } catch (e) {
      console.warn(`  stream upsertUsers: ${e.message}`);
    }

    for (const c of bible.channels ?? []) {
      const streamId = `prop-${propertyId.slice(0, 8)}-${slugify(c.name)}-${uuid().slice(0, 6)}`;
      const spaceId = c.spaceKey ? spaceByKey.get(c.spaceKey) ?? null : null;
      // Resolve members.
      let memberIds;
      if (c.memberScope === "all") {
        memberIds = [OWNER_USER_ID, ...[...personByKey.values()].map((p) => p.id)];
      } else if (c.memberScope === "space" && c.spaceKey) {
        const sp = bible.spaces.find((s) => s.key === c.spaceKey);
        memberIds = (sp?.memberKeys ?? []).map(personId).filter(Boolean);
        memberIds.push(OWNER_USER_ID);
      } else {
        memberIds = (c.memberKeys ?? []).map(personId).filter(Boolean);
      }
      memberIds = [...new Set(memberIds)];

      try {
        const channel = stream.channel("team", streamId, {
          name: c.name,
          members: memberIds,
          created_by_id: OWNER_USER_ID,
          property_id: propertyId,
        });
        await channel.create();
        lock.streamChannelIds.push(streamId);
        channelByKey.set(c.key, { streamId, channel });
      } catch (e) {
        console.warn(`  stream channel ${c.name}: ${e.message}`);
        continue;
      }

      // Mirror to chat_channels (so it lists in the app sidebar).
      const { error } = await sb.from("chat_channels").insert({
        property_id: propertyId,
        stream_channel_id: streamId,
        stream_channel_type: "team",
        name: c.name,
        space_id: spaceId,
        created_by: OWNER_USER_ID,
      });
      if (error) console.warn(`  chat_channels ${c.name}: ${error.message}`);
    }
    console.log(`✓ ${channelByKey.size} Stream channels (mirrored to chat_channels)`);
    writeLock(lock);


    // Post threads.
    let msgCount = 0;
    for (const thread of threads ?? []) {
      const ch = channelByKey.get(thread.channelKey);
      if (!ch) continue;
      for (const m of thread.messages ?? []) {
        const uid = personId(m.authorKey) ?? OWNER_USER_ID;
        try {
          await ch.channel.sendMessage({ text: m.text, user_id: uid });
          msgCount++;
        } catch (e) {
          console.warn(`  sendMessage (${thread.channelKey}): ${e.message}`);
        }
      }
    }
    console.log(`✓ ${msgCount} chat messages posted`);
  } else {
    console.log("  (skipping Stream — STREAM env unset)");
  }

  /* 10. Meetings + attendees. */
  let meetingCount = 0;
  for (const mt of meetings ?? []) {
    const id = uuid();
    const start = isoIn(mt.scheduledStartInDays ?? 0, mt.startHour ?? 10);
    const end = new Date(
      new Date(start).getTime() + (mt.durationMinutes ?? 30) * 60_000,
    ).toISOString();
    const hostId = personId(mt.hostKey) ?? OWNER_USER_ID;
    const { error } = await sb.from("meetings").insert({
      id,
      property_id: propertyId,
      stream_call_id: `demo-${id}`,
      stream_call_type: "default",
      title: mt.title,
      host_id: hostId,
      scheduled_start: start,
      scheduled_end: end,
      description: mt.description ?? null,
      location: mt.location ?? null,
    });
    if (error) {
      console.warn(`  meeting "${mt.title}": ${error.message}`);
      continue;
    }
    meetingCount++;
    const attendeeIds = new Set(
      (mt.attendeeKeys ?? []).map(personId).filter(Boolean),
    );
    attendeeIds.add(hostId);
    await sb.from("meeting_attendees").insert(
      [...attendeeIds].map((user_id) => ({
        meeting_id: id,
        user_id,
        response: user_id === hostId ? "accepted" : "pending",
        is_organizer: user_id === hostId,
      })),
    );
  }
  console.log(`✓ ${meetingCount} meetings (+ attendees)`);

  /* 11. A custom entity type ("Room") with a few rows — showcases the entities feature. */
  try {
    const etId = uuid();
    const { error } = await sb.from("entity_types").insert({
      id: etId,
      property_id: propertyId,
      name: "room",
      display_name: "Room",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          floor: { type: "number" },
          type: { type: "string" },
          status: { type: "string" },
        },
      },
      display_config: { primaryField: "name", color: "blue", icon: "🛏️" },
      created_by: OWNER_USER_ID,
    });
    if (!error) {
      const roomTypes = ["Standard King", "Deluxe Suite", "Ocean Villa", "Garden Room"];
      const statuses = ["available", "occupied", "cleaning", "maintenance"];
      const rows = Array.from({ length: 12 }, (_, i) => ({
        property_id: propertyId,
        entity_type_id: etId,
        data: {
          name: `Room ${101 + i}`,
          floor: 1 + Math.floor(i / 6),
          type: roomTypes[i % roomTypes.length],
          status: statuses[i % statuses.length],
        },
        created_by: OWNER_USER_ID,
      }));
      await sb.from("entities").insert(rows);
      console.log(`✓ 1 entity type "Room" + ${rows.length} entities`);
    }
  } catch (e) {
    console.warn(`  entities: ${e.message}`);
  }

  writeLock(lock);
  console.log(`\n✅ Demo seeded. Property: ${propName} (${propertyId})`);
  console.log(`   Lock file: ${LOCK_PATH}`);
  console.log(`   To remove: node --env-file=.env.local scripts/seed-demo.mjs --reset`);
}

/* ── Fix doc bodies (re-apply ProseMirror JSON to already-seeded docs) ──────── */

async function fixDocBodies() {
  const lock = readLock();
  if (!lock) {
    console.error("No demo-seed.lock.json — seed first.");
    process.exit(1);
  }
  if (!liveblocks) {
    console.error("LIVEBLOCKS_SECRET_KEY unset.");
    process.exit(1);
  }
  const content = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf8"));
  const blocksByTitle = new Map((content.docs ?? []).map((d) => [d.title, d.blocks]));
  const { data: docs, error } = await sb
    .from("documents")
    .select("id, title")
    .eq("property_id", lock.propertyId);
  if (error) throw new Error(error.message);

  let fixed = 0;
  for (const d of docs) {
    const blocks = blocksByTitle.get(d.title);
    if (!blocks) {
      console.warn(`  no content match for "${d.title}"`);
      continue;
    }
    try {
      await writeDocBody({
        id: d.id,
        roomId: roomIdForDocument(lock.propertyId, d.id),
        blocks,
      });
      fixed++;
    } catch (e) {
      console.warn(`  ${d.title}: ${e.message}`);
    }
    await sleep(300);
  }
  console.log(`✓ Re-wrote ${fixed}/${docs.length} document bodies as ProseMirror JSON`);
}

/* ── Backfill space_members (after the 0041 column-rename fix) ──────────────── */

async function fixSpaceMembers() {
  const lock = readLock();
  if (!lock) {
    console.error("No demo-seed.lock.json — seed first.");
    process.exit(1);
  }
  const { bible } = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf8"));

  const { data: spaces } = await sb
    .from("spaces")
    .select("id, name")
    .eq("property_id", lock.propertyId);
  const spaceIdByName = new Map((spaces ?? []).map((s) => [s.name, s.id]));

  const { data: mems } = await sb
    .from("memberships")
    .select("user_id")
    .eq("property_id", lock.propertyId);
  const { data: profs } = await sb
    .from("profiles")
    .select("id, full_name")
    .in("id", (mems ?? []).map((m) => m.user_id));
  const userIdByName = new Map((profs ?? []).map((p) => [p.full_name, p.id]));
  const nameByPersonaKey = new Map(bible.personas.map((p) => [p.key, p.fullName]));

  const rows = [];
  bible.spaces.forEach((s, idx) => {
    const spaceId = spaceIdByName.get(s.name);
    if (!spaceId) return;
    const memberIds = new Set();
    for (const mk of s.memberKeys ?? []) {
      const uid = userIdByName.get(nameByPersonaKey.get(mk));
      if (uid) memberIds.add(uid);
    }
    if (idx < 2) memberIds.add(OWNER_USER_ID); // owner sees themselves in spaces
    for (const user_id of memberIds) rows.push({ space_id: spaceId, user_id });
  });

  if (rows.length) {
    const { error } = await sb
      .from("space_members")
      .upsert(rows, { onConflict: "space_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  console.log(`✓ space_members backfilled: ${rows.length} rows across ${spaces?.length} spaces`);
}

/* ── Main ──────────────────────────────────────────────────────────────────── */

(async () => {
  try {
    if (process.argv.includes("--reset")) await reset();
    else if (process.argv.includes("--fix-doc-bodies")) await fixDocBodies();
    else if (process.argv.includes("--fix-space-members")) await fixSpaceMembers();
    else await seed();
  } catch (e) {
    console.error("\n❌ Seed failed:", e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
