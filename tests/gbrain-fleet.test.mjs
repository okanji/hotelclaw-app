// gbrain FLEET test — the companion to gbrain-integration.test.mjs.
//
//   node --env-file=apps/web/.env.local --no-network-family-autoselection \
//     tests/gbrain-fleet.test.mjs
//
// WHY THIS EXISTS (2026-08-06 audit): gbrain-integration.test.mjs asserts
// scoping against three PERMANENT FIXTURES (master / pod-oamar / canary).
// It was green while the real fleet had a revoked property credential, 10
// orphaned document mirrors, and a `think` op that returned "(no LLM
// available)". Fixtures are not the fleet. This test asserts the state of
// the ACTUAL per-property bindings in property_brains — the path 9 of 12
// properties use — plus the serve-side capabilities our bots depend on.
//
//   1 serve liveness + self-diagnosis   2 every stored binding authenticates
//   3 doc-mirror integrity (orphans / archived / cursor)
//   4 cross-property isolation on REAL bindings
//   5 capability: search, think synthesis, capture round-trip
//   6 latency budget vs the timeouts our callers actually use
//
// Failures here are real defects, not flakes. Read the audit notes in
// infra/railway-brain-serve/README.md before dismissing one.

import { createClient } from "@supabase/supabase-js";

let failed = false;
const warnings = [];
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  — ${extra}`}`);
  if (!cond) failed = true;
}
function warn(name, cond, extra = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    console.log(`WARN  ${name}  — ${extra}`);
    warnings.push(`${name}: ${extra}`);
  }
}

const URL_MCP = process.env.BRAIN_MCP_URL;
if (!URL_MCP) {
  console.error("BRAIN_MCP_URL is not set — run with --env-file=apps/web/.env.local");
  process.exit(1);
}
const ORIGIN = new URL(URL_MCP).origin;

// The web app's callers use a 30s default (packages/brain callBrain) and
// 60s for think (channel-brain.ts). A serve slower than this is a silent
// outage for the bots even though every op "works" from a shell.
const SEARCH_BUDGET_MS = 30_000;
const THINK_BUDGET_MS = 60_000;

// --- transport (mirrors packages/brain's SSE-aware tools/call) -------------

async function token(clientId, clientSecret) {
  const res = await fetch(`${ORIGIN}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* body already consumed or empty */
    }
    return { token: null, status: res.status, detail };
  }
  return { token: (await res.json()).access_token ?? null, status: 200, detail: "" };
}

async function call(bearer, name, args, timeoutMs = 60_000) {
  const res = await fetch(URL_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // The serve holds the SSE stream open after replying — read to the first
  // complete data: line then cancel, exactly like packages/brain does.
  const ct = res.headers.get("content-type") ?? "";
  let text;
  if (ct.includes("text/event-stream") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let line = null;
    try {
      while (line === null) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.includes("\n")) {
          const done = buffer
            .slice(0, buffer.lastIndexOf("\n"))
            .split("\n")
            .filter((l) => l.startsWith("data:"));
          if (done.length > 0) line = done[done.length - 1];
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    text = line ? line.slice(5) : "";
  } else {
    text = await res.text();
  }
  if (!text.trim()) return { isError: true, body: null };
  const payload = JSON.parse(text);
  const blocks = (payload.result?.content ?? []).map((b) => b.text ?? "").join("\n");
  let parsed;
  try {
    parsed = JSON.parse(blocks);
  } catch {
    parsed = blocks;
  }
  return { isError: Boolean(payload.result?.isError || payload.error), body: parsed };
}

// --- at-rest crypto (mirrors @hotelclaw/brain decryptBrainSecretWith) -----
// Inlined so the test runs as a plain script from the repo root with no
// workspace resolution, like gbrain-integration.test.mjs.

import { createDecipheriv, createHash } from "node:crypto";

function decryptBrainSecret(material, ciphertext) {
  const parts = String(ciphertext ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const key = createHash("sha256").update(`${material}:property-brains`).digest();
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    d.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      d.update(Buffer.from(dataB64, "base64url")),
      d.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------

async function main() {
  const material =
    process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // === 1. Serve liveness + the serve's own diagnosis ======================

  const health = await fetch(`${ORIGIN}/health`, {
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  check("1a serve /health ok", health?.status === "ok", JSON.stringify(health));
  check(
    "1b engine is postgres (shared state, not a local PGLite)",
    health?.engine === "postgres",
    `engine=${health?.engine}`,
  );

  const adminRaw = process.env.BRAIN_TOKEN_ADMIN ?? "";
  const adminSep = adminRaw.indexOf(":");
  const admin =
    adminSep > 0
      ? await token(adminRaw.slice(0, adminSep), adminRaw.slice(adminSep + 1))
      : { token: null };
  check("1c admin credential grants", Boolean(admin.token), admin.detail ?? "");

  if (admin.token) {
    const doctor = await call(admin.token, "run_doctor", {}, 120_000);
    const checks = doctor.body?.checks ?? [];
    const bad = checks.filter((c) => c.status !== "ok");
    // gbrain's own doctor is the upstream definition of "healthy". We do not
    // fail the suite on brain_score (it is a quality gauge that only climbs
    // with graph + timeline density), but every check is reported so a new
    // failure mode cannot hide.
    warn(
      "1d gbrain doctor reports healthy",
      doctor.body?.status === "healthy",
      `status=${doctor.body?.status} score=${doctor.body?.health_score}; ${bad
        .map((c) => `[${c.status}] ${c.name}`)
        .join(", ")}`,
    );
    for (const c of bad) console.log(`        ↳ ${c.status}: ${c.name} — ${c.message}`);

    const gh = await call(admin.token, "get_health", {}, 60_000);
    const embedCoverage = gh.body?.embed_coverage;
    check(
      "1e embeddings cover every chunk (vector arm live)",
      typeof embedCoverage === "number" && embedCoverage >= 0.99,
      `embed_coverage=${embedCoverage} missing=${gh.body?.missing_embeddings}`,
    );
    // The self-wiring knowledge graph is gbrain's headline retrieval
    // advantage (+31.4pp P@5 upstream over vector-only); zero edges means
    // we are getting a plain vector index out of it.
    //
    // Two independent causes, so read `run_doctor` above before acting:
    // if links_extraction_lag is WARNing, extraction is simply not running
    // (fix: `gbrain extract --stale` in the maintenance cron). If it is
    // OK and link_count is still 0 — the state after the 2026-08-06
    // backfill — extraction runs and finds nothing, because
    // renderDocumentBrainPage emits plain prose with no entity links for
    // it to wire. Earning the graph means emitting links in the mirror.
    warn(
      "1f knowledge graph has extracted edges",
      (gh.body?.link_count ?? 0) > 0,
      `link_count=0 across ${gh.body?.page_count} pages — see run_doctor's links_extraction_lag check to tell "not extracted" from "nothing to extract"`,
    );
  }

  // === 2. Every stored property binding actually authenticates ===========

  const { data: bindings, error: bindErr } = await supabase
    .from("property_brains")
    .select("property_id, source, client_id, client_secret_enc");
  check("2a property_brains readable", !bindErr && Array.isArray(bindings), bindErr?.message ?? "");
  if (!bindings) return;

  const live = [];
  for (const row of bindings) {
    const secret = decryptBrainSecret(material, row.client_secret_enc);
    if (!secret) {
      check(`2b ${row.source} secret decrypts`, false, "AES-GCM decrypt failed");
      continue;
    }
    const t = await token(row.client_id, secret);
    check(
      `2b ${row.source} credential grants a token`,
      Boolean(t.token),
      `HTTP ${t.status} ${t.detail}`,
    );
    if (t.token) live.push({ ...row, bearer: t.token });
  }

  // A binding row that cannot list is worse than no row: the Brain section
  // renders "Provisioned · Online" off the row + the SERVE's health, so a
  // dead credential looks like an empty brain.
  for (const b of live) {
    const listed = await call(b.bearer, "list_pages", { limit: 200 }, 60_000);
    check(
      `2c ${b.source} list_pages succeeds`,
      !listed.isError && Array.isArray(listed.body),
      JSON.stringify(listed.body).slice(0, 200),
    );
    b.pages = Array.isArray(listed.body) ? listed.body : [];
  }

  // === 3. Document-mirror integrity ======================================

  let orphans = 0;
  let archivedPresent = 0;
  let uuidTitled = 0;
  for (const b of live) {
    const docPages = (b.pages ?? []).filter((p) => String(p.slug).startsWith("documents/"));
    const ids = docPages.map((p) => String(p.slug).slice("documents/".length));
    const { data: docs } = ids.length
      ? await supabase
          .from("documents")
          .select("id, property_id, archived_at")
          .in("id", ids)
      : { data: [] };
    const byId = new Map((docs ?? []).map((d) => [d.id, d]));

    const orphan = docPages.filter((p) => !byId.has(String(p.slug).slice(10)));
    const archived = docPages.filter((p) => byId.get(String(p.slug).slice(10))?.archived_at);
    // A mirror page whose document belongs to ANOTHER property would mean
    // the source fence leaked on the write side. Non-negotiable.
    const foreign = docPages.filter((p) => {
      const d = byId.get(String(p.slug).slice(10));
      return d && d.property_id !== b.property_id;
    });
    const mangled = (b.pages ?? []).filter((p) => /^[0-9a-f]{8} /i.test(String(p.title ?? "")));

    orphans += orphan.length;
    archivedPresent += archived.length;
    uuidTitled += mangled.length;

    check(
      `3a ${b.source} no foreign-property mirror pages`,
      foreign.length === 0,
      `${foreign.length} pages map to another property's document`,
    );
  }
  check(
    "3b no mirror pages for deleted documents",
    orphans === 0,
    `${orphans} orphan pages — the doc-driven sweep cannot see these; run sweepOrphanedBrainPages`,
  );
  check(
    "3c no mirror pages for archived documents",
    archivedPresent === 0,
    `${archivedPresent} archived documents still readable in the brain`,
  );
  // Pages written before gbrain started deriving titles from the body H1
  // keep a slug-derived title ("E536b30a C4ff …"). Search/get resolve these
  // via resolveBrainSources, but brain_list and the Brain browser show them raw.
  warn(
    "3d mirror pages carry human titles",
    uuidTitled === 0,
    `${uuidTitled} pages have uuid-derived titles — re-mirror with scripts/brain-remirror-documents.mjs`,
  );

  // Cursor freshness, from the app side (what the overview strip reports).
  const { data: docRows } = await supabase
    .from("documents")
    .select("property_id, body_updated_at, brain_synced_at, archived_at")
    .is("archived_at", null);
  const bound = new Set(bindings.map((b) => b.property_id));
  const stale = (docRows ?? []).filter(
    (d) =>
      bound.has(d.property_id) &&
      (!d.brain_synced_at ||
        (d.body_updated_at &&
          Date.parse(d.body_updated_at) > Date.parse(d.brain_synced_at))),
  );
  check(
    "3e every active document of a bound property is mirrored",
    stale.length === 0,
    `${stale.length} documents behind the cursor`,
  );

  // === 4. Isolation on REAL property bindings ============================

  if (live.length >= 2) {
    const [a, b] = live;
    const victim = (b.pages ?? []).find((p) => String(p.slug).startsWith("documents/"));
    if (victim) {
      const cross = await call(a.bearer, "get_page", { slug: victim.slug }, 30_000);
      const blocked =
        cross.isError || /not.?found/i.test(JSON.stringify(cross.body ?? ""));
      check(
        "4a cross-property get_page is blocked",
        blocked,
        `${a.source} read ${b.source}'s page ${victim.slug}`,
      );

      const own = await call(b.bearer, "get_page", { slug: victim.slug }, 30_000);
      check(
        "4b the owning binding CAN read it (non-vacuous)",
        !own.isError && Boolean(own.body),
        "owner read failed — 4a may be passing for the wrong reason",
      );

      const ownIds = new Set(
        (a.pages ?? []).map((p) => String(p.slug)),
      );
      const search = await call(
        a.bearer,
        "search",
        { query: "policy procedure runbook", limit: 10 },
        SEARCH_BUDGET_MS + 30_000,
      );
      const hits = Array.isArray(search.body) ? search.body : [];
      check(
        "4c search results never cross the source fence",
        hits.every((h) => ownIds.has(String(h.slug))),
        `${hits.filter((h) => !ownIds.has(String(h.slug))).length} foreign slugs`,
      );
    }
  } else {
    check("4 isolation checked on real bindings", false, "fewer than 2 live bindings");
  }

  // === 5. Capabilities the bot tools advertise ===========================

  const probe = live[0];
  if (probe) {
    const t0 = Date.now();
    const search = await call(
      probe.bearer,
      "search",
      { query: "safety procedure", limit: 5 },
      SEARCH_BUDGET_MS + 60_000,
    );
    const searchMs = Date.now() - t0;
    check("5a search returns", !search.isError, JSON.stringify(search.body).slice(0, 200));

    // RETRIEVAL QUALITY, corpus-independent: search for a page's own title and
    // require that page back. If an exact-title query cannot find its page,
    // retrieval is broken regardless of how healthy every component looks.
    //
    // This exists because the 2026-08-06 audit found every part sound in
    // isolation — embeddings 100% covered and correct dimension, engine
    // `searchVector` returning the right document at rank 1 in ~1.3s — while
    // the fused `search`/`query` pipeline returned unrelated documents. Only
    // an end-to-end quality assertion catches that; component health does not.
    // The fixture must be DISTINCTIVE or the assertion is meaningless: a
    // first cut picked a page literally titled "Untitled document", whose
    // title matches half the corpus, and reported a retrieval failure that
    // was really a bad query. Drop slug-derived and placeholder titles, then
    // take the longest remaining one (longest ≈ most distinctive).
    const titled = (probe.pages ?? [])
      .filter(
        (p) =>
          typeof p.title === "string" &&
          p.title.length > 12 &&
          !/^[0-9a-f]{8} /i.test(p.title) &&
          !/^(untitled|new page|test|draft)\b/i.test(p.title.trim()),
      )
      .sort((a, b) => b.title.length - a.title.length)[0];
    if (titled) {
      const byTitle = await call(
        probe.bearer,
        "search",
        { query: titled.title, limit: 10 },
        SEARCH_BUDGET_MS + 60_000,
      );
      const slugs = (Array.isArray(byTitle.body) ? byTitle.body : []).map((h) =>
        String(h.slug),
      );
      check(
        "5a2 exact-title query returns its own page",
        slugs.includes(String(titled.slug)),
        `"${titled.title}" → ${slugs.slice(0, 5).join(", ") || "no hits"}`,
      );
    }

    // brain_think is advertised to every bot as "synthesized answer with
    // citations". Without an LLM key on the serve it gathers pages and
    // returns a placeholder — a silent capability outage.
    const t1 = Date.now();
    const think = await call(
      probe.bearer,
      "think",
      { question: "What safety procedures does this property have in place?" },
      THINK_BUDGET_MS + 120_000,
    );
    const thinkMs = Date.now() - t1;
    const synthesized =
      !think.isError &&
      think.body?.synthesisOk !== false &&
      !/no LLM available/i.test(String(think.body?.answer ?? ""));
    check(
      "5b think actually synthesizes an answer",
      synthesized,
      `synthesisOk=${think.body?.synthesisOk} warnings=${JSON.stringify(
        think.body?.warnings,
      )} — set ANTHROPIC_API_KEY on the Railway serve`,
    );

    // Capture round-trip: page-if-missing + timeline append, then read back.
    const slug = `operations/fleet-test-${Date.now().toString(36)}`;
    const marker = `fleet-test-${Math.random().toString(36).slice(2, 10)}`;
    const created = await call(
      probe.bearer,
      "put_page",
      {
        slug,
        content: `# Fleet test\n\n> Automated probe page — safe to delete.\n`,
        ingested_via: "hotelclaw-fleet-test",
      },
      30_000,
    );
    const appended = await call(
      probe.bearer,
      "add_timeline_entry",
      {
        slug,
        date: new Date().toISOString().slice(0, 10),
        summary: `Fleet test evidence ${marker}`,
        source: "tests/gbrain-fleet.test.mjs",
      },
      30_000,
    );
    const readback = await call(probe.bearer, "get_timeline", { slug, limit: 10 }, 30_000);
    const found = JSON.stringify(readback.body ?? "").includes(marker);
    check(
      "5c capture round-trip (put_page → timeline → read back)",
      !created.isError && !appended.isError && found,
      `put=${!created.isError} append=${!appended.isError} readback=${found}`,
    );
    await call(probe.bearer, "delete_page", { slug }, 30_000);

    // === 6. Latency vs the timeouts our callers actually pass ============

    check(
      "6a search inside the 30s caller timeout",
      searchMs < SEARCH_BUDGET_MS,
      `${searchMs}ms — packages/brain callBrain defaults to ${SEARCH_BUDGET_MS}ms`,
    );
    warn(
      "6b search comfortably fast (<10s)",
      searchMs < 10_000,
      `${searchMs}ms — every brain_search costs the bot this much turn latency`,
    );
    check(
      "6c think inside the 60s caller timeout",
      thinkMs < THINK_BUDGET_MS,
      `${thinkMs}ms — channel-brain.ts passes ${THINK_BUDGET_MS}ms`,
    );
  }

  console.log("");
  if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s) — degraded, not broken:`);
    for (const w of warnings) console.log(`  · ${w}`);
    console.log("");
  }
  console.log(failed ? "GBrain fleet test FAILED." : "GBrain fleet test passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("fleet test crashed:", e);
  process.exit(1);
});
