"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PropertyId = z.string().uuid();
const BoardId = z.string().uuid();
const DocumentId = z.string().uuid();
const Name = z.string().min(1).max(80);
const Color = z.enum(["slate", "blue", "green", "amber", "rose", "violet"]);

/** Sparse-float gap between siblings — same scheme as tasks (0010) + docs (0012). */
const POSITION_GAP = 1024;

type ActionError = { error: string };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// The generated `Database` types haven't been regenerated since the boards
// migration, so `from("document_boards")` resolves to `never`. Local cast
// types keep this file compiling until `supabase gen types` is rerun.
type BoardPositionRow = { position: number } | null;
type InsertedIdRow = { id: string } | null;

async function nextBoardPosition(
  supabase: ServerClient,
  propertyId: string,
): Promise<number> {
  const { data } = await supabase
    .from("document_boards")
    .select("position")
    .eq("property_id", propertyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as BoardPositionRow;
  return (row?.position ?? 0) + POSITION_GAP;
}

async function nextItemPosition(
  supabase: ServerClient,
  boardId: string,
): Promise<number> {
  const { data } = await supabase
    .from("document_board_items")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as BoardPositionRow;
  return (row?.position ?? 0) + POSITION_GAP;
}

/**
 * Create a new (empty) board, appended after any existing boards in the
 * property. Returns the new id so the caller can focus its inline rename.
 */
export async function createBoard(
  propertyId: string,
  name?: string,
): Promise<{ id: string } | ActionError> {
  const p = PropertyId.safeParse(propertyId);
  if (!p.success) return { error: "Invalid property id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const position = await nextBoardPosition(supabase, p.data);
  const trimmedName = (name ?? "").trim();

  const { data, error } = await supabase
    .from("document_boards")
    .insert({
      property_id: p.data,
      name: trimmedName || "New board",
      position,
      created_by: user.id,
    })
    .select("id")
    .single();
  const inserted = data as InsertedIdRow;
  if (error || !inserted) return { error: error?.message ?? "Insert failed" };

  revalidatePath(`/p/${p.data}/documents`);
  return { id: inserted.id };
}

export async function renameBoard(
  boardId: string,
  name: string,
): Promise<{ ok: true } | ActionError> {
  const b = BoardId.safeParse(boardId);
  const n = Name.safeParse(name);
  if (!b.success) return { error: "Invalid board id" };
  if (!n.success) return { error: "Name must be 1–80 characters" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("document_boards")
    .update({ name: n.data })
    .eq("id", b.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setBoardColor(
  boardId: string,
  color: string,
): Promise<{ ok: true } | ActionError> {
  const b = BoardId.safeParse(boardId);
  const c = Color.safeParse(color);
  if (!b.success) return { error: "Invalid board id" };
  if (!c.success) return { error: "Invalid color" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("document_boards")
    .update({ color: c.data })
    .eq("id", b.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteBoard(
  boardId: string,
): Promise<{ ok: true } | ActionError> {
  const b = BoardId.safeParse(boardId);
  if (!b.success) return { error: "Invalid board id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // `ON DELETE CASCADE` on document_board_items handles the row cleanup; the
  // docs themselves are untouched (they just become unpinned).
  const { error } = await supabase
    .from("document_boards")
    .delete()
    .eq("id", b.data);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function reorderBoard(
  boardId: string,
  position: number,
): Promise<{ ok: true } | ActionError> {
  const b = BoardId.safeParse(boardId);
  if (!b.success) return { error: "Invalid board id" };
  if (!Number.isFinite(position)) return { error: "Invalid position" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("document_boards")
    .update({ position })
    .eq("id", b.data);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Pin / move / reorder a document within boards. A doc lives on at most one
 * board (partial unique index on `document_id`) — re-pinning moves it across
 * boards. Pass `position = null` to append at the end of the target board;
 * pass an explicit position to slot between siblings (computed midpoint).
 *
 * Delete-then-insert because the uniqueness constraint is on `document_id`,
 * not on the (board_id, document_id) primary key — a plain `upsert` with
 * `onConflict: "board_id,document_id"` would let the same doc end up in two
 * boards. The pair runs in two round-trips; same-user drags don't realistically
 * race themselves.
 */
export async function pinDocument(
  documentId: string,
  boardId: string,
  position: number | null = null,
): Promise<{ ok: true } | ActionError> {
  const d = DocumentId.safeParse(documentId);
  const b = BoardId.safeParse(boardId);
  if (!d.success) return { error: "Invalid document id" };
  if (!b.success) return { error: "Invalid board id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const pos = position ?? (await nextItemPosition(supabase, b.data));

  const del = await supabase
    .from("document_board_items")
    .delete()
    .eq("document_id", d.data);
  if (del.error) return { error: del.error.message };

  const { error } = await supabase.from("document_board_items").insert({
    board_id: b.data,
    document_id: d.data,
    position: pos,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function unpinDocument(
  documentId: string,
): Promise<{ ok: true } | ActionError> {
  const d = DocumentId.safeParse(documentId);
  if (!d.success) return { error: "Invalid document id" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("document_board_items")
    .delete()
    .eq("document_id", d.data);
  if (error) return { error: error.message };
  return { ok: true };
}
