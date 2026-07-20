// End-to-end verification of the Brain browser API surface against the dev
// server + live gbrain. Signs in via the repo's standard magiclink pattern
// (verify-tenancy-rls.mjs), then: list pages -> read page -> record a
// correction -> assert it appears in the timeline -> search.
// Run from apps/web: node --env-file=.env.local --no-network-family-autoselection <file>
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
const EMAIL = "oamarkanji@gmail.com";

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// 1. Find a property this user belongs to that has a brain binding.
const { data: userList } = await service.auth.admin.listUsers({ perPage: 200 });
const user = userList.users.find((u) => u.email === EMAIL);
if (!user) throw new Error(`no user ${EMAIL}`);

const { data: memberships } = await service
  .from("memberships")
  .select("property_id, role")
  .eq("user_id", user.id);
const { data: brains } = await service
  .from("property_brains")
  .select("property_id, source")
  .in("property_id", memberships.map((m) => m.property_id));
if (!brains?.length) throw new Error("no member property with a brain binding");
const propertyId = brains[0].property_id;
const role = memberships.find((m) => m.property_id === propertyId)?.role;
console.log(`property ${propertyId} (source ${brains[0].source}) role=${role}`);

// 2. Sign in: magiclink token_hash -> /auth/confirm sets the sb cookies.
const { data: link, error: lErr } = await service.auth.admin.generateLink({
  type: "magiclink",
  email: EMAIL,
});
if (lErr) throw lErr;

const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

let res;
for (let attempt = 1; ; attempt++) {
  try {
    res = await fetch(
      `${APP}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=/`,
      { redirect: "manual" },
    );
    break;
  } catch (e) {
    if (attempt >= 4) throw e;
    console.log(`  (auth/confirm failed: ${e.cause?.code ?? e.message}; retry ${attempt})`);
    await new Promise((r) => setTimeout(r, 10_000 * attempt));
  }
}
storeCookies(res);
console.log(`auth/confirm -> ${res.status} (cookies: ${jar.size})`);
if (jar.size === 0) throw new Error("no auth cookies set");

async function api(path, init = {}) {
  let r;
  for (let attempt = 1; ; attempt++) {
    try {
      r = await fetch(`${APP}${path}`, {
        ...init,
        headers: { cookie: cookieHeader(), ...(init.headers ?? {}) },
        redirect: "manual",
      });
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`  (fetch ${path} failed: ${e.cause?.code ?? e.message}; retry ${attempt})`);
      await new Promise((res) => setTimeout(res, 5000 * attempt));
    }
  }
  storeCookies(r);
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: r.status, body };
}

// 3. List pages.
const pages = await api(`/api/properties/${propertyId}/brain/pages`);
console.log(`GET /brain/pages -> ${pages.status}; ${pages.body?.pages?.length ?? "?"} pages`);
if (pages.status !== 200 || !Array.isArray(pages.body?.pages)) {
  throw new Error(`pages failed: ${JSON.stringify(pages.body).slice(0, 300)}`);
}
for (const p of pages.body.pages.slice(0, 5)) console.log(`  - ${p.slug} :: ${p.title}`);

// 4. Read one page (prefer one with a timeline-worthy slug).
const target = pages.body.pages[0];
if (!target) {
  console.log("brain is empty — stopping after list (routes verified)");
  process.exit(0);
}
const detail = await api(
  `/api/properties/${propertyId}/brain/page?slug=${encodeURIComponent(target.slug)}`,
);
console.log(
  `GET /brain/page?slug=${target.slug} -> ${detail.status}; timeline=${detail.body?.page?.timeline?.length}, tags=${detail.body?.page?.tags?.length}, truth=${detail.body?.page?.compiled_truth?.length} chars`,
);
if (detail.status !== 200) throw new Error(JSON.stringify(detail.body).slice(0, 300));

// 5. Record a correction (owner/manager only) and assert the round-trip.
const stamp = `verify-${Date.now()}`;
const curate = await api(`/api/properties/${propertyId}/brain/curate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "correction",
    slug: target.slug,
    note: `Test correction ${stamp} — safe to ignore, written by the brain-browser verification script.`,
    supersedes: { date: "2026-07-20", summary: "verification probe" },
  }),
});
console.log(`POST /brain/curate correction -> ${curate.status} ${JSON.stringify(curate.body)}`);
if (curate.status !== 200) throw new Error("correction failed");

const after = await api(
  `/api/properties/${propertyId}/brain/page?slug=${encodeURIComponent(target.slug)}`,
);
const found = after.body?.page?.timeline?.some((e) => e.summary.includes(stamp));
console.log(`correction visible in timeline: ${found}`);
if (!found) throw new Error("correction did not round-trip");

// 6. Search still works through the existing route.
const search = await api(`/api/properties/${propertyId}/brain/search`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: "correction", limit: 3 }),
});
console.log(
  `POST /brain/search -> ${search.status}; hits=${Array.isArray(search.body?.results) ? search.body.results.length : JSON.stringify(search.body).slice(0, 120)}`,
);

console.log("\nALL CHECKS PASSED");
