import "server-only";
/**
 * Loader for the Brain overview strip (components/brain/brain-overview.tsx).
 * Everything here is derivable from data the app already owns — the
 * property_brains / clients binding, a /health probe of the shared serve,
 * documents.brain_synced_at, and the page index the browser already fetched
 * — so the overview needs NO new gbrain op. All reads go through the service
 * client (property_brains is service-role only); nothing sensitive crosses
 * to the client (see BrainOverview — plain JSON).
 */
import { createServiceClient } from "@/lib/supabase/server";
import { provisionTransport } from "@/lib/brain/provision";
import type {
  BrainOverview,
  BrainPageSummary,
  BrainStatusKind,
} from "@/lib/brain/shared";

const DOC_SAMPLE = 4000; // staleness compared in JS (PostgREST can't compare two columns)
const RECENT_LIMIT = 8;

async function probeHealth(): Promise<BrainOverview["health"] & { reachable: boolean }> {
  const empty = { status: null, version: null, engine: null, reachable: false };
  const url = process.env.BRAIN_MCP_URL;
  if (!url) return empty;
  try {
    const res = await fetch(`${new URL(url).origin}/health`, {
      // 8s, not 3s: a cold /health on the shared serve measured 1.8s and the
      // fleet test caught it exceeding 3s under load. Timing out here renders
      // a red "Server unreachable" badge on a perfectly healthy brain — the
      // same class of lie as the green badge over a revoked credential.
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return empty;
    const body = (await res.json()) as {
      status?: string;
      version?: string;
      engine?: string;
    };
    return {
      status: body.status ?? null,
      version: body.version ?? null,
      engine: body.engine ?? null,
      reachable: true,
    };
  } catch {
    return empty;
  }
}

async function loadStatus(propertyId: string): Promise<BrainOverview["status"]> {
  const service = createServiceClient();
  const transport = provisionTransport();

  const [{ data: pbRow }, { data: property }] = await Promise.all([
    service
      .from("property_brains")
      .select("source, created_at")
      .eq("property_id", propertyId)
      .maybeSingle(),
    service
      .from("properties")
      .select("client_id")
      .eq("id", propertyId)
      .maybeSingle(),
  ]);

  if (pbRow) {
    return {
      kind: "per_property",
      source: pbRow.source,
      provisionedAt: pbRow.created_at,
      podStatus: null,
      canProvision: false,
      transport,
    };
  }

  if (property?.client_id) {
    const { data: client } = await service
      .from("clients")
      .select("brain_source, status")
      .eq("id", property.client_id)
      .maybeSingle();
    return {
      kind: "pod",
      source: client?.brain_source ?? null,
      provisionedAt: null,
      podStatus: client?.status ?? null,
      canProvision: false, // pods inherit their client's binding — never provision
      transport,
    };
  }

  const kind: BrainStatusKind = "none";
  return {
    kind,
    source: null,
    provisionedAt: null,
    podStatus: null,
    canProvision: transport !== null,
    transport,
  };
}

async function loadDocCoverage(propertyId: string): Promise<BrainOverview["docCoverage"]> {
  const service = createServiceClient();
  // Active docs only (archived → deleted from the brain). Mirror doc-sync's
  // definition of "active" (archived_at is null) and its staleness rule
  // (never-synced, or body touched after the last sync).
  const { data: rows } = await service
    .from("documents")
    .select("body_updated_at, brain_synced_at")
    .eq("property_id", propertyId)
    .is("archived_at", null)
    .limit(DOC_SAMPLE);

  const docs = rows ?? [];
  let synced = 0;
  let stale = 0;
  let lastSyncMs = 0;
  for (const d of docs) {
    const s = d.brain_synced_at ? Date.parse(d.brain_synced_at) : null;
    if (s === null) {
      stale += 1;
      continue;
    }
    synced += 1;
    if (s > lastSyncMs) lastSyncMs = s;
    if (d.body_updated_at && Date.parse(d.body_updated_at) > s) stale += 1;
  }

  return {
    total: docs.length,
    synced,
    stale,
    lastSyncAt: lastSyncMs > 0 ? new Date(lastSyncMs).toISOString() : null,
    approximate: docs.length >= DOC_SAMPLE,
  };
}

function deriveKnowledge(
  pages: BrainPageSummary[] | null,
): BrainOverview["knowledge"] {
  const list = pages ?? [];
  const counts = new Map<string, number>();
  for (const page of list) {
    const namespace = page.slug.includes("/")
      ? page.slug.slice(0, page.slug.indexOf("/"))
      : "general";
    counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
  }
  return {
    total: list.length,
    namespaces: [...counts.entries()]
      .map(([namespace, count]) => ({ namespace, count }))
      .sort((a, b) => b.count - a.count || a.namespace.localeCompare(b.namespace)),
  };
}

/**
 * Assemble the overview. `pages` is the index the page already fetched for
 * the browser (avoids a second list_pages round-trip); pass null when the
 * property has no binding.
 *
 * `hasBinding` distinguishes the two reasons `pages` can be null — no
 * binding at all vs. a binding whose credential failed. Without it a
 * revoked client renders as an empty brain (see BrainOverview.bindingOk).
 */
export async function loadBrainOverview(
  propertyId: string,
  pages: BrainPageSummary[] | null,
  { hasBinding }: { hasBinding: boolean },
): Promise<BrainOverview> {
  const [status, health, docCoverage] = await Promise.all([
    loadStatus(propertyId),
    probeHealth(),
    loadDocCoverage(propertyId),
  ]);
  const { reachable, ...healthFields } = health;

  return {
    status,
    health: healthFields,
    healthReachable: reachable,
    // listBrainPages returns [] for a genuinely empty brain and null only on
    // a transport/auth failure — so this is a real verification, not a guess.
    bindingOk: hasBinding ? pages !== null : null,
    docCoverage,
    knowledge: deriveKnowledge(pages),
    recent: (pages ?? []).slice(0, RECENT_LIMIT),
  };
}
