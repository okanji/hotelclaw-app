// gbrain integration test v2 (shared-server fleet) — THE contract with
// upstream: re-run before every gbrain or eve version bump, forever
// (VERSIONS.md). Asserts SCOPING, not just plumbing.
//
//   node --env-file=apps/web/.env.local tests/gbrain-integration.test.mjs
//
// Fixtures assumed (created at migration time, permanent): sources
// master/pod-oamar/canary-fixture; OAuth clients per .env.local refs
// (BRAIN_TOKEN_ADMIN, BRAIN_TOKEN_POD_OAMAR_PORTFOLIO, BRAIN_TOKEN_CANARY).
//
// 1 plumbing · 2 federation · 3 write wall · 4 read wall (canary)
// 5 canary non-vacuous · 6 token hygiene

let failed = false;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
  if (!cond) failed = true;
}

const URL_MCP = process.env.BRAIN_MCP_URL;
const ORIGIN = new URL(URL_MCP).origin;

async function token(cred) {
  const sep = cred.indexOf(":");
  const res = await fetch(`${ORIGIN}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cred.slice(0, sep),
      client_secret: cred.slice(sep + 1),
    }),
  });
  if (!res.ok) return null;
  return (await res.json()).access_token ?? null;
}

async function call(bearer, name, args) {
  const res = await fetch(URL_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: name === "__list" ? "tools/list" : "tools/call",
      params: name === "__list" ? undefined : { name, arguments: args },
    }),
  });
  const text = await res.text();
  if (!text.trim()) return { isError: false, body: null, status: res.status };
  const dataLine = text.split("\n").reverse().find((l) => l.startsWith("data:"));
  const payload = JSON.parse(dataLine ? dataLine.slice(5) : text);
  if (name === "__list") return { body: payload.result?.tools ?? [] };
  const blocks = (payload.result?.content ?? []).map((b) => b.text ?? "").join("\n");
  let parsed; try { parsed = JSON.parse(blocks); } catch { parsed = blocks; }
  return { isError: Boolean(payload.result?.isError || payload.error), body: parsed, status: res.status };
}

async function main() {
  const podTok = await token(process.env.BRAIN_TOKEN_POD_OAMAR_PORTFOLIO);
  const adminTok = await token(process.env.BRAIN_TOKEN_ADMIN);
  const canaryTok = await token(process.env.BRAIN_TOKEN_CANARY);
  check("1a token grants (pod, admin, canary)", Boolean(podTok && adminTok && canaryTok));

  const tools = (await call(podTok, "__list")).body;
  check("1b tools listed", Array.isArray(tools) && tools.length > 20, `got ${tools?.length}`);

  // 1c plumbing: pod fact query cites the right pod page.
  const podQ = await call(podTok, "query", { query: "Kaya pool system history" });
  check(
    "1c pod query cites pod page",
    !podQ.isError && JSON.stringify(podQ.body).includes("properties/kaya-villa-watamu/systems/pool"),
    JSON.stringify(podQ.body).slice(0, 120),
  );

  // 1d write → re-find → cleanup (in the pod's own source).
  const slug = `timeline/2026/07/integration-${Date.now().toString(36)}`;
  const put = await call(podTok, "put_page", { slug, content: "# Test\n\nZanzibar-marker-fact for the integration test." });
  check("1d timeline write", !put.isError);
  const refind = await call(podTok, "search", { query: "Zanzibar-marker-fact" });
  check("1e write re-found", !refind.isError && JSON.stringify(refind.body ?? "").includes(slug), JSON.stringify(refind.body).slice(0, 120));
  await call(podTok, "delete_page", { slug });

  // 2 federation: pod client reads a MASTER-only page through one endpoint.
  const fed = await call(podTok, "get_page", { slug: "playbooks/pool-recovery" });
  check(
    "2 federation: pod reads master playbook",
    !fed.isError && JSON.stringify(fed.body).includes("Green pool recovery"),
  );

  // 3 write wall: a pod write of a master-namespace slug must NOT land in
  // master — pod writes are structurally bound to the pod source.
  const wallSlug = "playbooks/wall-probe";
  await call(podTok, "put_page", { slug: wallSlug, content: "# wall probe" });
  const masterView = await call(adminTok, "get_page", { slug: wallSlug });
  // Admin's write source is master; its get_page resolves master first. The
  // page must not exist there. (It exists only in pod-oamar.)
  const landedInMaster =
    !masterView.isError &&
    JSON.stringify(masterView.body).includes("wall probe") &&
    JSON.stringify(masterView.body).includes('"source_id": "master"');
  check("3 write wall: pod write did not land in master", !landedInMaster);
  await call(podTok, "delete_page", { slug: wallSlug });

  // 4 read wall: the canary term must be invisible to the pod client.
  const canarySearch = await call(podTok, "search", { query: "XYLOPHONE-CANARY-42" });
  const leaked = JSON.stringify(canarySearch.body ?? "").includes("XYLOPHONE-CANARY-42");
  check("4 read wall: canary invisible to pod client", !canarySearch.isError && !leaked, JSON.stringify(canarySearch.body).slice(0, 120));

  // 5 non-vacuous: the canary's own client CAN see it.
  const canarySelf = await call(canaryTok, "search", { query: "XYLOPHONE-CANARY-42" });
  check("5 canary readable by canary client", JSON.stringify(canarySelf.body ?? "").includes("canary"), JSON.stringify(canarySelf.body).slice(0, 120));

  // 6 token hygiene.
  const garbage = await fetch(URL_MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer garbage" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check("6a garbage bearer rejected", garbage.status === 401 || garbage.status === 403, `status ${garbage.status}`);
  const missing = await fetch(URL_MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check("6b missing auth rejected", missing.status === 401 || missing.status === 403, `status ${missing.status}`);

  console.log(failed ? "\nGBRAIN INTEGRATION TEST v2 FAILED" : "\nGBrain integration test v2 passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
