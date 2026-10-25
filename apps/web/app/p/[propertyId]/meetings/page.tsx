import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMeetings } from "@/lib/meetings/queries";
import { ImportTranscriptDialog } from "@/components/chat/meeting/import-transcript-dialog";
import { AutomationsButton } from "@/components/workflows/automations-button";
import { MeetingsIndex } from "@/components/meetings/meetings-index";

export const dynamic = "force-dynamic";

/**
 * Meetings index — Upcoming / Live / Past over every meeting in the property,
 * with search and the two real creation paths (schedule via the calendar's
 * event dialog, start-now via the meeting provider). Server-rendered (a
 * sidebar pushState exception) because meetings are mostly visited via deep
 * links from chat and the inbox.
 */
export default async function MeetingsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const supabase = await createClient();

  // RLS will return zero rows for non-members — surface as 404 instead of an
  // empty page that hints the property exists.
  const [{ data: property }, { data: auth }] = await Promise.all([
    supabase
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .is("archived_at", null)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!property || !auth.user) notFound();

  const [meetings, { data: channels }] = await Promise.all([
    getMeetings(supabase, propertyId, 200),
    // Channels the viewer can see (RLS) — the Start-meeting picker. A meeting
    // is always tied to a channel: that's where its summary posts back.
    supabase
      .from("chat_channels")
      .select("stream_channel_id, name")
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("name"),
  ]);

  return (
    <MeetingsIndex
      propertyId={propertyId}
      currentUserId={auth.user.id}
      meetings={meetings}
      channels={(channels ?? []).map((c) => ({
        streamChannelId: c.stream_channel_id,
        name: c.name,
      }))}
      headerActions={
        <>
          <AutomationsButton propertyId={propertyId} feature="meetings" />
          <ImportTranscriptDialog propertyId={propertyId} />
        </>
      }
    />
  );
}
