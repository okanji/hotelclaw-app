import "server-only";
/**
 * Browse layer over the shared gbrain serve — the read + curation surface
 * behind the Brain section (`/p/[propertyId]/agents/brain`).
 *
 * Same trust model as lib/brain/client.ts: tenancy is the property's OAuth
 * client (resolved server-side via resolvePropertyBrain), never tool args.
 * Reads are member-gated at the route; curation writes are role-gated.
 *
 * Curation is deliberately NARROW. The serve has no per-entry retract op,
 * and compiled truth is human/dream-cycle territory — so the app offers
 * exactly two verbs:
 *   - correction: append a clearly-marked operator correction to the page's
 *     timeline (supersede-by-append — survives dream-cycle recompilation,
 *     which a direct page edit would not).
 *   - archive: soft-delete the whole page (`delete_page`, 72h recovery
 *     window on the serve). Owner-only; the strongest retraction we expose.
 */
import { callBrainTool, type BrainBinding, type BrainResult } from "@/lib/brain/client";
import {
  CORRECTION_MARK,
  type BrainPageDetailData,
  type BrainPageSummary,
  type BrainTimelineEntry,
} from "@/lib/brain/shared";

export type { BrainPageSummary, BrainTimelineEntry };
export type BrainPageDetail = BrainPageDetailData;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function listBrainPages(
  binding: BrainBinding | null,
  { limit = 100 }: { limit?: number } = {},
): Promise<BrainPageSummary[] | null> {
  const result = await callBrainTool(binding, "list_pages", {
    limit,
    sort: "updated_desc",
  });
  if (!result.ok || !Array.isArray(result.content)) return null;
  return result.content.flatMap((raw): BrainPageSummary[] => {
    const row = asRecord(raw);
    if (!row || typeof row.slug !== "string") return [];
    return [
      {
        slug: row.slug,
        type: typeof row.type === "string" ? row.type : "page",
        title: typeof row.title === "string" && row.title ? row.title : row.slug,
        updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
      },
    ];
  });
}

export async function readBrainPage(
  binding: BrainBinding | null,
  slug: string,
): Promise<BrainPageDetail | null> {
  const [pageResult, timelineResult] = await Promise.all([
    callBrainTool(binding, "get_page", { slug }),
    callBrainTool(binding, "get_timeline", { slug, limit: 100 }),
  ]);
  const page = pageResult.ok ? asRecord(pageResult.content) : null;
  if (!page || typeof page.slug !== "string") return null;

  const timeline: BrainTimelineEntry[] = (
    timelineResult.ok && Array.isArray(timelineResult.content)
      ? timelineResult.content
      : []
  ).flatMap((raw): BrainTimelineEntry[] => {
    const row = asRecord(raw);
    if (!row || typeof row.summary !== "string") return [];
    return [
      {
        id: typeof row.id === "number" ? row.id : 0,
        date: typeof row.date === "string" ? row.date.slice(0, 10) : "",
        source: typeof row.source === "string" ? row.source : "",
        summary: row.summary,
        detail: typeof row.detail === "string" ? row.detail : "",
      },
    ];
  });

  const contentFlag = asRecord(page.content_flag);
  return {
    slug: page.slug,
    title: typeof page.title === "string" && page.title ? page.title : page.slug,
    type: typeof page.type === "string" ? page.type : "page",
    tags: Array.isArray(page.tags)
      ? page.tags.filter((t): t is string => typeof t === "string")
      : [],
    compiled_truth:
      typeof page.compiled_truth === "string" ? page.compiled_truth : "",
    created_at: typeof page.created_at === "string" ? page.created_at : "",
    updated_at: typeof page.updated_at === "string" ? page.updated_at : "",
    ...(contentFlag &&
    typeof contentFlag.reason === "string" &&
    typeof contentFlag.detail === "string"
      ? { content_flag: { reason: contentFlag.reason, detail: contentFlag.detail } }
      : {}),
    timeline,
  };
}

/**
 * Append an operator correction to a page's timeline. `supersedes` ties the
 * correction to the entry it overrides so the UI can render the pairing.
 */
export async function captureBrainCorrection(
  binding: BrainBinding | null,
  input: {
    slug: string;
    note: string;
    author: string;
    supersedes?: { date: string; summary: string };
  },
): Promise<BrainResult> {
  const detailParts = [
    input.supersedes
      ? `Supersedes the ${input.supersedes.date} entry: "${input.supersedes.summary.slice(0, 200)}"`
      : null,
    `Recorded by ${input.author} from the Brain section. Treat this correction as authoritative over the entry it references.`,
  ].filter(Boolean);
  return callBrainTool(binding, "add_timeline_entry", {
    slug: input.slug,
    date: new Date().toISOString().slice(0, 10),
    summary: `${CORRECTION_MARK} ${input.note.slice(0, 500)}`,
    detail: detailParts.join("\n"),
    source: `operator:${input.author}`,
  });
}

/** Soft-delete a page (recoverable server-side for 72h via restore_page). */
export async function archiveBrainPage(
  binding: BrainBinding | null,
  slug: string,
): Promise<BrainResult> {
  return callBrainTool(binding, "delete_page", { slug });
}
