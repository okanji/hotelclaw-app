// Smoke test for the document → brain mirror (lib/brain/doc-sync.ts).
// Run from apps/web with the dev server env:
//
//   node --env-file=.env.local --no-network-family-autoselection \
//     scripts/brain-doc-sync-test.mjs [--property <uuid>]
//
// Exercises, against the REAL brain serve:
//   1. seed a throwaway document row (service client, body_text set)
//   2. syncDocumentToBrain equivalent (direct: sweep targets the row)
//   3. brain get_page documents/<id> → must contain the marker text
//   4. archive the doc, re-sync → page soft-deleted (get returns nothing)
//   5. cleanup (hard-delete the row)
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const propArg = args.includes("--property")
  ? args[args.indexOf("--property") + 1]
  : "d58fc73b-9077-404d-9f2b-6eb56902d91a"; // Solana Cove demo property

const APP = process.env.APP_ORIGIN ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const MARKER = `smoke-${Date.now().toString(36)}`;
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

// Resolve the property's brain binding the same way the app does — via the
// sync-documents cron (which exercises the real resolution path). We only
// need direct brain reads for asserts, so use the property_brains row.
async function brainCall(tool, callArgs) {
  const { data: row } = await sb
    .from("property_brains")
    .select("source, client_id, client_secret_enc")
    .eq("property_id", propArg)
    .maybeSingle();
  if (!row) return { ok: false, reason: "no property_brains row" };
  // Decrypt via the app's own crypto (node can't import TS; replicate the
  // scheme — v1.iv.tag.data AES-256-GCM, key = sha256(secret:property-brains)).
  const { createDecipheriv, createHash } = await import("node:crypto");
  const secretMaterial =
    process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  const parts = row.client_secret_enc.split(".");
  const key = createHash("sha256")
    .update(`${secretMaterial}:property-brains`)
    .digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parts[1], "base64url"),
  );
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  const clientSecret = Buffer.concat([
    decipher.update(Buffer.from(parts[3], "base64url")),
    decipher.final(),
  ]).toString("utf8");

  const url = process.env.BRAIN_MCP_URL;
  const origin = new URL(url).origin;
  const tokenRes = await fetch(`${origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: row.client_id,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) return { ok: false, reason: `token ${tokenRes.status}` };
  const { access_token } = await tokenRes.json();

  const res = await fetch(url, {
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
      params: { name: tool, arguments: callArgs },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const contentType = res.headers.get("content-type") ?? "";
  let payload;
  if (contentType.includes("text/event-stream")) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLine = null;
    while (dataLine === null) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.includes("\n")) {
        const complete = buffer
          .slice(0, buffer.lastIndexOf("\n"))
          .split("\n")
          .filter((l) => l.startsWith("data:"));
        if (complete.length > 0) dataLine = complete[complete.length - 1];
      }
    }
    reader.cancel().catch(() => {});
    if (!dataLine) return { ok: false, reason: "empty SSE" };
    payload = JSON.parse(dataLine.slice(5));
  } else {
    payload = await res.json();
  }
  if (payload.error) return { ok: false, reason: payload.error.message };
  const text = (payload.result?.content ?? [])
    .filter((b) => typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  if (payload.result?.isError) return { ok: false, reason: text.slice(0, 200) };
  return { ok: true, text };
}

async function runSweep() {
  const res = await fetch(`${APP}/api/brain/sync-documents`, {
    headers: CRON_SECRET ? { authorization: `Bearer ${CRON_SECRET}` } : {},
  });
  return res.ok ? res.json() : { error: res.status };
}

// 1. Seed a throwaway doc.
const { data: doc, error: insErr } = await sb
  .from("documents")
  .insert({
    property_id: propArg,
    title: `Doc-sync smoke ${MARKER}`,
    body_text: `This is the doc-sync smoke test body. Marker: ${MARKER}. The walk-in freezer must stay below -18C.`,
    body_updated_at: new Date().toISOString(),
  })
  .select("id")
  .single();
if (insErr) {
  console.error("seed failed:", insErr.message);
  process.exit(1);
}
console.log("seeded doc", doc.id);

try {
  // 2. Sweep (webhook path can't be exercised without a Liveblocks edit).
  const sweep1 = await runSweep();
  check("sweep ran", !sweep1.error, JSON.stringify(sweep1));

  // 3. Page exists with marker.
  const page = await brainCall("get_page", { slug: `documents/${doc.id}` });
  check(
    "mirror page contains marker",
    page.ok && page.text.includes(MARKER),
    page.ok ? "" : page.reason,
  );

  // Cursor advanced?
  const { data: row1 } = await sb
    .from("documents")
    .select("brain_synced_at")
    .eq("id", doc.id)
    .single();
  check("brain_synced_at set", !!row1?.brain_synced_at);

  // 4. Archive → sweep → page gone.
  await sb
    .from("documents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", doc.id);
  const sweep2 = await runSweep();
  check("archive sweep ran", !sweep2.error, JSON.stringify(sweep2));
  const gone = await brainCall("get_page", { slug: `documents/${doc.id}` });
  check(
    "mirror page removed after archive",
    !gone.ok || !gone.text || !gone.text.includes(MARKER),
  );
} finally {
  // 5. Cleanup.
  await sb.from("documents").delete().eq("id", doc.id);
  console.log("cleaned up", doc.id);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
