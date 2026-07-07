import type {
  DocumentBoardRow,
  DocumentPresenceEntry,
  PropertyMember,
} from "@/lib/query/section-queries";
import { uniquePresenceUsers } from "@/lib/documents/presence";

export type DocActivityKind =
  | "viewing"
  | "edited"
  | "pinned"
  | "board-created";

export type DocActivityItem = {
  id: string;
  kind: DocActivityKind;
  at: string;
  documentId?: string;
  documentTitle?: string;
  boardId?: string;
  boardName?: string;
  actorId?: string | null;
  actorName?: string;
  viewers?: { id: string; name: string; avatar?: string }[];
};

type DocRow = {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
  created_by: string | null;
  last_edited_by: string | null;
};

const MAX_ITEMS = 24;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

function memberName(
  members: Map<string, PropertyMember>,
  userId: string | null | undefined,
): string | undefined {
  if (!userId) return undefined;
  const m = members.get(userId);
  return m?.name ?? undefined;
}

/**
 * Merge DB-backed events (edits, pins, new boards) with live Liveblocks
 * presence into a single timeline for the docs home activity panel.
 */
export function buildDocActivity({
  docs,
  boards,
  members,
  presence,
  now = Date.now(),
}: {
  docs: DocRow[];
  boards: DocumentBoardRow[];
  members: PropertyMember[];
  presence: DocumentPresenceEntry[];
  now?: number;
}): DocActivityItem[] {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const cutoff = now - RECENT_MS;
  const items: DocActivityItem[] = [];

  for (const entry of presence) {
    const viewers = uniquePresenceUsers(entry.users);
    if (viewers.length === 0) continue;
    const doc = docsById.get(entry.documentId);
    items.push({
      id: `viewing:${entry.documentId}`,
      kind: "viewing",
      at: new Date(now).toISOString(),
      documentId: entry.documentId,
      documentTitle: doc?.title ?? "Untitled",
      viewers,
    });
  }

  for (const doc of docs) {
    const updated = new Date(doc.updated_at).getTime();
    if (updated < cutoff) continue;
    items.push({
      id: `edited:${doc.id}:${doc.updated_at}`,
      kind: "edited",
      at: doc.updated_at,
      documentId: doc.id,
      documentTitle: doc.title,
      actorId: doc.last_edited_by,
      actorName: memberName(memberMap, doc.last_edited_by),
    });
  }

  for (const board of boards) {
    const created = new Date(board.created_at).getTime();
    if (created >= cutoff) {
      items.push({
        id: `board:${board.id}:created`,
        kind: "board-created",
        at: board.created_at,
        boardId: board.id,
        boardName: board.name,
        actorId: board.created_by,
        actorName: memberName(memberMap, board.created_by),
      });
    }

    for (const item of board.items) {
      const pinned = new Date(item.created_at).getTime();
      if (pinned < cutoff) continue;
      const doc = docsById.get(item.document_id);
      items.push({
        id: `pinned:${item.document_id}:${item.created_at}`,
        kind: "pinned",
        at: item.created_at,
        documentId: item.document_id,
        documentTitle: doc?.title ?? "Untitled",
        boardId: board.id,
        boardName: board.name,
      });
    }
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // Viewing rows are synthetic "now" — keep them at the top, then recent history.
  const viewing = items.filter((i) => i.kind === "viewing");
  const rest = items
    .filter((i) => i.kind !== "viewing")
    .slice(0, MAX_ITEMS - viewing.length);

  return [...viewing, ...rest];
}

export function presenceByDocumentId(
  presence: DocumentPresenceEntry[],
): Map<string, DocumentPresenceEntry["users"]> {
  const m = new Map<string, DocumentPresenceEntry["users"]>();
  for (const entry of presence) {
    const users = uniquePresenceUsers(entry.users);
    if (users.length > 0) m.set(entry.documentId, users);
  }
  return m;
}
