import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ScopeGrant, ScopeKind } from "@/lib/db/types";
import {
  addUserToPublicChannels,
  removeUserFromChannels,
  upsertStreamUser,
} from "@/lib/stream/server";

type Db = SupabaseClient<Database>;

export const SCOPE_KINDS: readonly ScopeKind[] = ["space", "list", "task", "document", "channel"];

const TABLE: Record<ScopeKind, "spaces" | "lists" | "tasks" | "documents" | "chat_channels"> = {
  space: "spaces",
  list: "lists",
  task: "tasks",
  document: "documents",
  channel: "chat_channels",
};

/**
 * Keep only grants whose target exists IN this property (an id from another
 * tenant, or a typo, is dropped — never trusted). Pass the service client:
 * the caller's own RLS may not see every row it is allowed to share.
 */
export async function validateScopes(
  db: Db,
  propertyId: string,
  scopes: ScopeGrant[],
): Promise<ScopeGrant[]> {
  const out: ScopeGrant[] = [];
  const seen = new Set<string>();
  for (const kind of SCOPE_KINDS) {
    const ids = [...new Set(scopes.filter((s) => s.kind === kind).map((s) => s.id))];
    if (ids.length === 0) continue;
    const { data } = await db
      .from(TABLE[kind])
      .select("id")
      .eq("property_id", propertyId)
      .in("id", ids);
    const real = new Set((data ?? []).map((r: { id: string }) => r.id));
    for (const s of scopes) {
      const key = `${s.kind}:${s.id}`;
      if (s.kind === kind && real.has(s.id) && !seen.has(key)) {
        seen.add(key);
        out.push({ kind: s.kind, id: s.id, can_edit: !!s.can_edit });
      }
    }
  }
  return out;
}

/** Write grants for a guest (upsert; an existing grant takes the new can_edit). */
export async function applyGuestScopes(
  db: Db,
  args: { propertyId: string; userId: string; scopes: ScopeGrant[]; grantedBy: string | null },
): Promise<{ error?: string }> {
  if (args.scopes.length === 0) return {};
  const { error } = await db.from("member_scopes").upsert(
    args.scopes.map((s) => ({
      property_id: args.propertyId,
      user_id: args.userId,
      scope_kind: s.kind,
      scope_id: s.id,
      can_edit: s.can_edit,
      granted_by: args.grantedBy,
    })),
    { onConflict: "property_id,user_id,scope_kind,scope_id" },
  );
  return error ? { error: error.message } : {};
}

/**
 * Make a guest's Stream channel memberships match their grants: the channels
 * of granted teams (and their sub-teams) plus individually granted channels.
 * Removes them from every other channel of the property. Service client.
 */
export async function syncGuestChannels(
  db: Db,
  args: { propertyId: string; userId: string },
): Promise<void> {
  const { data: grants } = await db
    .from("member_scopes")
    .select("scope_kind, scope_id")
    .eq("property_id", args.propertyId)
    .eq("user_id", args.userId);
  const spaceIds = new Set(
    (grants ?? []).filter((g) => g.scope_kind === "space").map((g) => g.scope_id),
  );
  if (spaceIds.size > 0) {
    const { data: subs } = await db
      .from("spaces")
      .select("id")
      .eq("property_id", args.propertyId)
      .in("parent_space_id", [...spaceIds]);
    for (const s of subs ?? []) spaceIds.add(s.id);
  }
  const channelIds = new Set(
    (grants ?? []).filter((g) => g.scope_kind === "channel").map((g) => g.scope_id),
  );
  const { data: channels } = await db
    .from("chat_channels")
    .select("id, space_id, stream_channel_id, stream_channel_type")
    .eq("property_id", args.propertyId)
    .is("archived_at", null);
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const c of channels ?? []) {
    if (c.stream_channel_type && c.stream_channel_type !== "team") continue;
    const ok = channelIds.has(c.id) || (c.space_id ? spaceIds.has(c.space_id) : false);
    (ok ? allowed : denied).push(c.stream_channel_id);
  }
  // Stream refuses channel updates naming a user it has never seen (a guest
  // granted before their first sign-in) — make sure they exist first.
  const { data: profile } = await db
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", args.userId)
    .maybeSingle();
  try {
    await upsertStreamUser({
      id: args.userId,
      name: profile?.full_name ?? "Guest",
      image: profile?.avatar_url ?? null,
    });
  } catch (err) {
    console.error("[guests] stream user upsert failed", err);
  }
  await addUserToPublicChannels({
    propertyId: args.propertyId,
    userId: args.userId,
    streamChannelIds: allowed,
  });
  await removeUserFromChannels({ userId: args.userId, streamChannelIds: denied });
}
