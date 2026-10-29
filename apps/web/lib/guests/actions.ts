"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireManagement } from "@/lib/auth/session";
import type { ScopeGrant } from "@/lib/db/types";
import { applyGuestScopes, syncGuestChannels, validateScopes } from "./scopes";

/**
 * Guest grants (0118). Owner / manager only — `requireManagement` here and
 * the `member_scopes` RLS (management, and only onto GUEST memberships)
 * agree. Every change re-syncs the guest's Stream channels. No
 * revalidatePath: nothing the MANAGER sees changes, and the refresh it
 * triggered raced the dialog's reload (the new grant didn't appear).
 */

const Kind = z.enum(["space", "list", "task", "document", "channel"]);
const Grant = z.object({ kind: Kind, id: z.string().uuid(), can_edit: z.boolean().default(false) });

export type GuestGrantRow = {
  id: string;
  scope_kind: ScopeGrant["kind"];
  scope_id: string;
  can_edit: boolean;
  /** Resolved display name of the shared thing. */
  label: string;
};

export async function listGuestGrants(input: {
  propertyId: string;
  userId: string;
}): Promise<{ grants: GuestGrantRow[] } | { error: string }> {
  const parsed = z.object({ propertyId: z.string().uuid(), userId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const gate = await requireManagement(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_scopes")
    .select("id, scope_kind, scope_id, can_edit")
    .eq("property_id", parsed.data.propertyId)
    .eq("user_id", parsed.data.userId)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message };
  const rows = data ?? [];
  const byKind = (k: string) => rows.filter((r) => r.scope_kind === k).map((r) => r.scope_id);
  const [spaces, lists, tasks, docs, channels] = await Promise.all([
    byKind("space").length ? supabase.from("spaces").select("id, name").in("id", byKind("space")) : { data: [] },
    byKind("list").length ? supabase.from("lists").select("id, name").in("id", byKind("list")) : { data: [] },
    byKind("task").length ? supabase.from("tasks").select("id, title").in("id", byKind("task")) : { data: [] },
    byKind("document").length ? supabase.from("documents").select("id, title").in("id", byKind("document")) : { data: [] },
    byKind("channel").length ? supabase.from("chat_channels").select("id, name").in("id", byKind("channel")) : { data: [] },
  ]);
  const names = new Map<string, string>();
  for (const r of (spaces.data ?? []) as { id: string; name: string }[]) names.set(r.id, r.name);
  for (const r of (lists.data ?? []) as { id: string; name: string }[]) names.set(r.id, r.name);
  for (const r of (tasks.data ?? []) as { id: string; title: string }[]) names.set(r.id, r.title);
  for (const r of (docs.data ?? []) as { id: string; title: string }[]) names.set(r.id, r.title || "Untitled document");
  for (const r of (channels.data ?? []) as { id: string; name: string }[]) names.set(r.id, `#${r.name}`);
  return {
    grants: rows.map((r) => ({
      id: r.id,
      scope_kind: r.scope_kind,
      scope_id: r.scope_id,
      can_edit: r.can_edit,
      label: names.get(r.scope_id) ?? "Removed item",
    })),
  };
}

export async function grantGuestScope(input: {
  propertyId: string;
  userId: string;
  grant: z.input<typeof Grant>;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = z
    .object({ propertyId: z.string().uuid(), userId: z.string().uuid(), grant: Grant })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const gate = await requireManagement(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };
  const service = createServiceClient();
  const { data: member } = await service
    .from("memberships")
    .select("role")
    .eq("property_id", parsed.data.propertyId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();
  if (member?.role !== "guest") return { error: "Only guests get individual grants" };
  const valid = await validateScopes(service, parsed.data.propertyId, [parsed.data.grant]);
  if (valid.length === 0) return { error: "That item isn't in this property" };
  // Through the caller's RLS client so the management policy is the final say.
  const supabase = await createClient();
  const res = await applyGuestScopes(supabase, {
    propertyId: parsed.data.propertyId,
    userId: parsed.data.userId,
    scopes: valid,
    grantedBy: gate.userId,
  });
  if (res.error) return { error: res.error };
  await syncGuestChannels(service, { propertyId: parsed.data.propertyId, userId: parsed.data.userId });
  return { ok: true };
}

export async function revokeGuestScope(input: {
  propertyId: string;
  grantId: string;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = z.object({ propertyId: z.string().uuid(), grantId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const gate = await requireManagement(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_scopes")
    .delete()
    .eq("id", parsed.data.grantId)
    .eq("property_id", parsed.data.propertyId)
    .select("user_id");
  if (error) return { error: error.message };
  const userId = data?.[0]?.user_id;
  if (userId) {
    await syncGuestChannels(createServiceClient(), { propertyId: parsed.data.propertyId, userId });
  }
  return { ok: true };
}

export async function setGuestScopeEdit(input: {
  propertyId: string;
  grantId: string;
  canEdit: boolean;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = z
    .object({ propertyId: z.string().uuid(), grantId: z.string().uuid(), canEdit: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const gate = await requireManagement(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("member_scopes")
    .update({ can_edit: parsed.data.canEdit })
    .eq("id", parsed.data.grantId)
    .eq("property_id", parsed.data.propertyId);
  return error ? { error: error.message } : { ok: true };
}

/** Everything a guest could be given — teams, lists, documents — for the picker. */
export async function listShareTargets(propertyId: string): Promise<
  | {
      spaces: { id: string; name: string }[];
      lists: { id: string; name: string; space_id: string | null }[];
      documents: { id: string; title: string }[];
    }
  | { error: string }
> {
  const gate = await requireManagement(propertyId);
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const [spaces, lists, docs] = await Promise.all([
    supabase.from("spaces").select("id, name").eq("property_id", propertyId).is("archived_at", null).order("name"),
    supabase.from("lists").select("id, name, space_id").eq("property_id", propertyId).is("archived_at", null).order("name"),
    supabase
      .from("documents")
      .select("id, title")
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);
  return {
    spaces: spaces.data ?? [],
    lists: lists.data ?? [],
    documents: (docs.data ?? []).map((d) => ({ id: d.id, title: d.title || "Untitled document" })),
  };
}
