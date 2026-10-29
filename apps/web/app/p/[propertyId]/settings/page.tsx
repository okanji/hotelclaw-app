import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserMemberships, requireUser } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/roles";
import type { CycleSettingsRow } from "@/lib/cycles/types";
import { SettingsView } from "@/components/gr8r/settings-view";

export const dynamic = "force-dynamic";

/**
 * `/p/<id>/settings` — gr8r's Settings page (`?sec=<section>` picks the
 * panel). Server-loads what the panels need on first paint: the caller's
 * profile, the property row, and (management) the cycle cadences; everything
 * else is fetched by the panel that owns it.
 */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ sec?: string }>;
}) {
  const { propertyId } = await params;
  const { sec } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: property }, { data: profile }, memberships] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, slug, timezone, task_prefix, channel_creation, client_id")
      .eq("id", propertyId)
      .is("archived_at", null)
      .maybeSingle(),
    supabase.from("profiles").select("full_name, avatar_url").eq("id", user.id).maybeSingle(),
    getUserMemberships(),
  ]);
  if (!property) notFound();

  const role = memberships.find((m) => m.property_id === propertyId)?.role ?? null;

  let cadences: CycleSettingsRow[] = [];
  if (canManage(role)) {
    const { data } = await supabase
      .from("cycle_settings")
      .select("*")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: true });
    cadences = (data ?? []) as CycleSettingsRow[];
  }

  return (
    <SettingsView
      propertyId={propertyId}
      initialSection={sec ?? null}
      role={role}
      user={{
        id: user.id,
        email: user.email ?? "",
        name: profile?.full_name ?? null,
        avatarUrl: profile?.avatar_url ?? null,
      }}
      property={{
        id: property.id,
        name: property.name,
        slug: property.slug,
        timezone: property.timezone,
        taskPrefix: property.task_prefix,
        channelCreation: property.channel_creation,
        isPod: property.client_id !== null,
      }}
      cadences={cadences}
    />
  );
}
