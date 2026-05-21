import type { DocumentBoardRow } from "@/lib/query/section-queries";

export const SPARKLINE_DAYS = 14;

type ActivityPoint = {
  at: string;
  documentId?: string;
};

type DocTimestampRow = {
  id: string;
  updated_at: string;
  created_at: string;
};

/** Collect edit, pin, and board timestamps for sparkline bucketing. */
export function collectActivityTimestamps(
  docs: DocTimestampRow[],
  boards: DocumentBoardRow[],
): ActivityPoint[] {
  const points: ActivityPoint[] = [];

  for (const doc of docs) {
    points.push({ at: doc.updated_at, documentId: doc.id });
    if (doc.created_at !== doc.updated_at) {
      points.push({ at: doc.created_at, documentId: doc.id });
    }
  }

  for (const board of boards) {
    points.push({ at: board.created_at });
    for (const item of board.items) {
      points.push({ at: item.created_at, documentId: item.document_id });
    }
  }

  return points;
}

/** Bucket activity into daily counts over the last N days (oldest → newest). */
export function bucketActivityByDay(
  points: ActivityPoint[],
  options?: {
    days?: number;
    now?: number;
    documentId?: string;
  },
): number[] {
  const days = options?.days ?? SPARKLINE_DAYS;
  const now = options?.now ?? Date.now();
  const documentId = options?.documentId;
  const dayMs = 24 * 60 * 60 * 1000;
  const start = now - (days - 1) * dayMs;
  const buckets = Array<number>(days).fill(0);

  for (const point of points) {
    if (documentId && point.documentId !== documentId) continue;
    const t = new Date(point.at).getTime();
    if (t < start || t > now + dayMs) continue;
    const index = Math.min(
      days - 1,
      Math.max(0, Math.floor((t - start) / dayMs)),
    );
    buckets[index] += 1;
  }

  return buckets;
}

export function sumBuckets(buckets: number[]): number {
  return buckets.reduce((sum, value) => sum + value, 0);
}

/** Boost today's bucket for live viewers on the property sparkline. */
export function bumpLiveToday(
  buckets: number[],
  liveViewerCount: number,
): number[] {
  if (liveViewerCount <= 0 || buckets.length === 0) return buckets;
  const next = [...buckets];
  next[next.length - 1] += liveViewerCount;
  return next;
}
