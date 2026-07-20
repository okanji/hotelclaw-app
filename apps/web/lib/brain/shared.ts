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
