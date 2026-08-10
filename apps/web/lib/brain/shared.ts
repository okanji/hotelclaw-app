/**
 * Brain browse types + markers shared between the server layer
 * (lib/brain/browse.ts) and the client components (components/brain/*).
 * No server-only imports here — this module ships to the client.
 */

export type BrainPageSummary = {
  slug: string;
  type: string;
  title: string;
  updated_at: string;
};

export type BrainTimelineEntry = {
  id: number;
  date: string;
  source: string;
  summary: string;
  detail: string;
};

export type BrainPageDetailData = {
  slug: string;
  title: string;
  type: string;
  tags: string[];
  compiled_truth: string;
  created_at: string;
  updated_at: string;
  content_flag?: { reason: string; detail: string };
  timeline: BrainTimelineEntry[];
};

/** Marker prefixing every operator correction — the UI renders these distinctly. */
export const CORRECTION_MARK = "⚠️ Correction:";

/**
 * Brain overview — the insight strip on the Brain section. Plain JSON so it
 * crosses the server→client boundary safely (no binding, no credentials).
 */
export type BrainStatusKind = "per_property" | "pod" | "none";

export type BrainOverview = {
  status: {
    kind: BrainStatusKind;
    /** The gbrain source id backing this property (null when brainless). */
    source: string | null;
    /** property_brains.created_at — per-property bindings only. */
    provisionedAt: string | null;
    /** Pod client status when kind === "pod". */
    podStatus: "active" | "paused" | "offboarded" | null;
    /** Owner can mint a binding from the UI (kind==="none" + a transport). */
    canProvision: boolean;
    /** How this host would provision (messaging only). */
    transport: "cli" | "http" | null;
  };
  /** Shared serve liveness (probed server-side; url never reaches client). */
  health: { status: string | null; version: string | null; engine: string | null };
  healthReachable: boolean;
  /**
   * Did THIS property's credential actually answer, this render?
   *
   * `healthReachable` only proves the shared SERVE is up — it says nothing
   * about the property's own OAuth client. A revoked client (observed
   * 2026-08-06 on prop-f47be200: `invalid_grant / Client has been revoked`)
   * used to render as "Provisioned · Online" with an empty knowledge map,
   * i.e. indistinguishable from a brand-new brain. Null when there is no
   * binding to verify.
   */
  bindingOk: boolean | null;
  /** Document mirror coverage, from documents.brain_synced_at. */
  docCoverage: {
    total: number;
    synced: number;
    stale: number;
    lastSyncAt: string | null;
    /** True when the property has more docs than we sampled for staleness. */
    approximate: boolean;
  };
  /** Page counts by namespace (slug's first path segment). */
  knowledge: { total: number; namespaces: { namespace: string; count: number }[] };
  /** Newest pages — "what the brain learned lately". */
  recent: BrainPageSummary[];
};
