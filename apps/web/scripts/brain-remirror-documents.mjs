// Force a re-mirror of document → brain pages, ignoring the sync cursor.
//
//   # from apps/web, with the dev server (or APP_ORIGIN) running
//   node --env-file=.env.local --no-network-family-autoselection \
//     scripts/brain-remirror-documents.mjs --stale-titles
//   node ... scripts/brain-remirror-documents.mjs --property <uuid>
//   node ... scripts/brain-remirror-documents.mjs --all
//   node ... scripts/brain-remirror-documents.mjs --stale-titles --dry-run
//
// WHY: documents.brain_synced_at is the ONLY staleness signal, and it only
// tracks drift on the APP side. Drift on the BRAIN side is invisible to it.
// The case that motivated this (2026-08-06 audit): pages written on or
// before 2026-07-23 kept a slug-derived title ("E536b30a C4ff 4733 …")
// because the serve did not yet derive titles from the body H1. 63 of 84
// mirror pages were affected. The cursor said "fresh", so no sweep would
// ever have fixed them — brain_list and the Brain browser showed uuid
// gibberish where a human expects "Night Audit Runbook".
//
// Mechanism: null the cursor for the targeted documents, then drive the
// real /api/brain/sync-documents sweep until it drains. Deliberately NOT a
// reimplementation of renderDocumentBrainPage — there is one renderer
// (@hotelclaw/brain) and this script must not become a second one.
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => (has(f) ? args[args.indexOf(f) + 1] : null);

const DRY = has("--dry-run");
const APP = process.env.APP_ORIGIN ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;
const BRAIN_URL = process.env.BRAIN_MCP_URL;
const MATERIAL =
  process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;

if (!has("--all") && !has("--stale-titles") && !val("--property")) {
  console.error(
    "Pick a target: --stale-titles (uuid-derived titles) | --property <uuid> | --all",
  );
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// --- minimal brain read (mirrors @hotelclaw/brain; read-only, list_pages) --

import { createDecipheriv, createHash } from "node:crypto";

function decrypt(ciphertext) {
  const parts = String(ciphertext ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, iv, tag, data] = parts;
    const key = createHash("sha256").update(`${MATERIAL}:property-brains`).digest();
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      d.update(Buffer.from(data, "base64url")),
      d.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

async function listPages(row) {
  const secret = decrypt(row.client_secret_enc);
  if (!secret) return null;
  const origin = new URL(BRAIN_URL).origin;
  const tokRes = await fetch(`${origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: row.client_id,
      client_secret: secret,
    }),
  });
  if (!tokRes.ok) return null;
  const { access_token } = await tokRes.json();

  const res = await fetch(BRAIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_pages", arguments: { limit: 500, sort: "updated_desc" } },
    }),
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
  const payload = JSON.parse(text);
  const blocks = (payload.result?.content ?? []).map((b) => b.text ?? "").join("\n");
  try {
    return JSON.parse(blocks);
  } catch {
    return null;
  }
}

// --- target selection ------------------------------------------------------

/** A title the serve derived from the slug rather than the body H1. */
const UUID_TITLE_RX = /^[0-9a-f]{8} /i;

async function targets() {
  const property = val("--property");
  if (has("--all") || property) {
    let q = sb
      .from("documents")
      .select("id, title, property_id")
      .is("archived_at", null);
    if (property) q = q.eq("property_id", property);
    const { data } = await q;
    return (data ?? []).map((d) => ({ ...d, why: property ? "property" : "all" }));
  }

  // --stale-titles: ask each property's brain which mirror pages carry a
  // uuid-derived title, then map those slugs back to live documents.
  const { data: bindings } = await sb
    .from("property_brains")
    .select("property_id, source, client_id, client_secret_enc");
  const out = [];
  for (const row of bindings ?? []) {
    const pages = await listPages(row);
    if (!pages) {
      console.log(`  ! ${row.source}: could not list pages (skipped)`);
      continue;
    }
    const bad = pages.filter(
      (p) =>
        typeof p?.slug === "string" &&
        p.slug.startsWith("documents/") &&
        UUID_TITLE_RX.test(String(p.title ?? "")),
    );
    if (bad.length === 0) continue;
    const ids = bad.map((p) => p.slug.slice("documents/".length));
    const { data: docs } = await sb
      .from("documents")
      .select("id, title, property_id")
      .eq("property_id", row.property_id)
      .is("archived_at", null)
      .in("id", ids);
    console.log(
      `  ${row.source}: ${bad.length} uuid-titled page(s), ${(docs ?? []).length} map to a live document`,
    );
    out.push(...(docs ?? []).map((d) => ({ ...d, why: "stale-title" })));
  }
  return out;
}

// --- drive the real sweep --------------------------------------------------

/**
 * Drive one sweep pass.
 *
 * Deliberately node:http and not fetch: a full pass re-mirrors up to 200
 * documents at a few seconds of put_page each, which blows past undici's
 * 300s headers timeout (UND_ERR_HEADERS_TIMEOUT) with no way to raise it on
 * the global fetch. The cursor is already reset at this point, so a timeout
 * here would strand the backfill half-done.
 */
import http from "node:http";
import https from "node:https";

function sweep() {
  const url = new URL("/api/brain/sync-documents", APP);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: "GET",
        headers: CRON_SECRET ? { authorization: `Bearer ${CRON_SECRET}` } : {},
        timeout: 900_000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`sync-documents returned ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`sync-documents returned non-JSON: ${body.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("sweep timed out after 15m")));
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  console.log("Selecting documents to re-mirror…");
  const docs = await targets();
  if (docs.length === 0) {
    console.log("Nothing to re-mirror.");
    return;
  }
  console.log(`\n${docs.length} document(s) targeted:`);
  for (const d of docs.slice(0, 15)) console.log(`  · ${d.title}`);
  if (docs.length > 15) console.log(`  … and ${docs.length - 15} more`);

  if (DRY) {
    console.log("\n--dry-run: cursor NOT reset, no sync driven.");
    return;
  }

  // Reset the cursor in batches so the sweep sees them as stale.
  const ids = docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await sb
      .from("documents")
      .update({ brain_synced_at: null })
      .in("id", ids.slice(i, i + 100));
    if (error) throw new Error(`cursor reset failed: ${error.message}`);
  }
  console.log(`\nCursor reset for ${ids.length} document(s). Driving the sweep…`);

  // The sweep is bounded (200/run) — drain it.
  let remaining = ids.length;
  let guard = 0;
  while (remaining > 0 && guard < 25) {
    const counts = await sweep();
    console.log(
      `  sweep: scanned=${counts.scanned} mirrored=${counts.mirrored} deleted=${counts.deleted} failed=${counts.failed}`,
    );
    if (counts.scanned === 0) break;
    remaining -= counts.mirrored + counts.deleted + counts.skipped;
    guard += 1;
  }

  const { data: left } = await sb
    .from("documents")
    .select("id")
    .in("id", ids)
    .is("brain_synced_at", null);
  console.log(
    `\nDone. ${ids.length - (left ?? []).length}/${ids.length} re-mirrored${
      (left ?? []).length ? `, ${(left ?? []).length} still pending (re-run)` : ""
    }.`,
  );
  console.log(
    "Verify with: node --env-file=apps/web/.env.local tests/gbrain-fleet.test.mjs (check 3d)",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
