// HTTP provisioning smoke test — proves the serve-side flow that
// lib/brain/provision.ts:provisionViaHttp runs from Vercel:
//
//   1. sources_add (MCP, BRAIN_TOKEN_ADMIN)            — bare source
//   2. POST /admin/login (GBRAIN_ADMIN_BOOTSTRAP_TOKEN) — session cookie
//   3. POST /admin/api/register-client                  — mint client
//   4. POST /admin/api/rescope-client                   — fence to source
//   5. token exchange as the NEW client, write + search in own source
//   6. FENCE: the new client must NOT read master pages or canary terms
//   7. cleanup: delete page, revoke client, remove source
//
// Requires the serve pinned ≥ gbrain 69bc37f7 (rescope-client).
//
//   node --env-file=.env.local --no-network-family-autoselection \
//     scripts/brain-provision-http-test.mjs
//
// Run from apps/web. Creates only throwaway artifacts (prop-smoke-*) and
// removes them; safe against the live shared serve.

let failed = false;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
  if (!cond) failed = true;
};

const URL_MCP = process.env.BRAIN_MCP_URL;
const BOOTSTRAP = process.env.GBRAIN_ADMIN_BOOTSTRAP_TOKEN;
const ADMIN = process.env.BRAIN_TOKEN_ADMIN;
if (!URL_MCP || !BOOTSTRAP || !ADMIN) {
  console.error("need BRAIN_MCP_URL, BRAIN_TOKEN_ADMIN, GBRAIN_ADMIN_BOOTSTRAP_TOKEN");
  process.exit(1);
}
const ORIGIN = new URL(URL_MCP).origin;

async function oauthToken(cred) {
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

async function mcp(bearer, name, args) {
  const res = await fetch(URL_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const dataLine = text.split("\n").reverse().find((l) => l.startsWith("data:"));
  const payload = JSON.parse(dataLine ? dataLine.slice(5) : text);
  const blocks = (payload.result?.content ?? []).map((b) => b.text ?? "").join("\n");
  let parsed; try { parsed = JSON.parse(blocks); } catch { parsed = blocks; }
  return { isError: Boolean(payload.result?.isError || payload.error), body: parsed };
}

async function adminPost(path, body, cookie) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let parsed = {};
  try { parsed = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: parsed, setCookie: res.headers.get("set-cookie") };
}

async function main() {
  const nonce = Date.now().toString(36);
  const source = `prop-smoke-${nonce}`;
  const adminTok = await oauthToken(ADMIN);
  check("0 admin MCP token", Boolean(adminTok));

  // 1. Source.
  const added = await mcp(adminTok, "sources_add", { id: source, name: source });
  check("1 sources_add (bare, remote)", !added.isError, JSON.stringify(added.body).slice(0, 200));

  // 2. Admin login (server-to-server: JSON in, cookie out).
  const login = await adminPost("/admin/login", { token: BOOTSTRAP });
  const cookie = login.setCookie?.match(/gbrain_admin=[^;]+/)?.[0];
  check("2 admin login → cookie", login.status === 200 && Boolean(cookie), `status ${login.status}`);

  // 3. Register (lands on 'default', to be rescoped).
  const reg = await adminPost(
    "/admin/api/register-client",
    { name: `smoke-${nonce}`, scopes: "read write", grantTypes: ["client_credentials"] },
    cookie,
  );
  const { clientId, clientSecret } = reg.body ?? {};
  check("3 register-client returns credentials", reg.status === 200 && clientId && clientSecret, JSON.stringify(reg.body).slice(0, 200));

  // 4. Rescope to the smoke source.
  const rescope = await adminPost(
    "/admin/api/rescope-client",
    { clientId, sourceId: source, federatedRead: [source] },
    cookie,
  );
  check("4 rescope-client to source", rescope.status === 200, `status ${rescope.status} ${JSON.stringify(rescope.body).slice(0, 200)}`);

  // 5. The minted client works and writes land in ITS source.
  const propTok = await oauthToken(`${clientId}:${clientSecret}`);
  check("5a minted client token exchange", Boolean(propTok));
  const slug = `smoke/provision-${nonce}`;
  const put = await mcp(propTok, "put_page", { slug, content: `# Smoke\n\nGiraffe-marker-${nonce} provisioning probe.` });
  check("5b write in own source", !put.isError, JSON.stringify(put.body).slice(0, 200));
  const found = await mcp(propTok, "search", { query: `Giraffe-marker-${nonce}` });
  check("5c write re-found via search", !found.isError && JSON.stringify(found.body).includes(slug), JSON.stringify(found.body).slice(0, 160));

  // 6. FENCE: no read of master content or canary.
  const master = await mcp(propTok, "get_page", { slug: "playbooks/pool-recovery" });
  const masterLeaked = !master.isError && JSON.stringify(master.body).includes("Green pool recovery");
  check("6a fence: master playbook invisible", !masterLeaked);
  const canary = await mcp(propTok, "search", { query: "XYLOPHONE-CANARY-42" });
  check("6b fence: canary invisible", !JSON.stringify(canary.body ?? "").includes("XYLOPHONE-CANARY-42"));

  // 7. Cleanup (best-effort; smoke artifacts are namespaced prop-smoke-*).
  // Order matters: revoke soft-deletes the client (row kept), and
  // oauth_clients.source_id is ON DELETE RESTRICT — so rescope the client
  // OFF the smoke source before revoking, else sources_remove hits the FK.
  await mcp(propTok, "delete_page", { slug });
  await adminPost(
    "/admin/api/rescope-client",
    { clientId, sourceId: "default", federatedRead: ["default"] },
    cookie,
  );
  const revoke = await adminPost("/admin/api/revoke-client", { clientId }, cookie);
  check("7a revoke minted client", revoke.status === 200, `status ${revoke.status}`);
  const removed = await mcp(adminTok, "sources_remove", { id: source, confirm_destructive: true });
  check("7b remove smoke source", !removed.isError, JSON.stringify(removed.body).slice(0, 200));
  const deadTok = await oauthToken(`${clientId}:${clientSecret}`);
  check("7c revoked client can no longer mint tokens", !deadTok);

  console.log(failed ? "\nHTTP PROVISIONING SMOKE FAILED" : "\nHTTP provisioning smoke passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
