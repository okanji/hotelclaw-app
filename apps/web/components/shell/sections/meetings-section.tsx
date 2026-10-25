"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarPlus, Sparkles, Video } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

type RecentMeeting = {
  id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  scheduled_start: string | null;
  has_summary: boolean;
};

/**
 * Secondary-sidebar content for the Meetings section: "All meetings" +
 * "Schedule meeting" (deep-links `?schedule=1`, which the index opens then
 * strips), the next few scheduled meetings, and the most recent ones. The full
 * page (with summaries / participants / transcripts) renders in the main
 * content area at /meetings.
 */
export function MeetingsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const base = `/p/${propertyId}/meetings`;
  const onIndex = pathname === base || pathname === `${base}/`;

  const { data } = useQuery({
    queryKey: ["meetings-recent", propertyId],
    queryFn: async (): Promise<RecentMeeting[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("meetings")
        .select(
          "id, title, started_at, ended_at, scheduled_start, meeting_summaries(id)",
        )
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw new Error(error.message);
      return (data ?? []).map((m) => ({
        id: m.id,
        title: m.title,
        started_at: m.started_at ?? new Date(0).toISOString(),
        ended_at: m.ended_at,
        scheduled_start: m.scheduled_start,
        has_summary: (m.meeting_summaries ?? []).length > 0,
      }));
    },
    // 30s feels right — the realtime channel below pushes inserts faster
    // than this, but if we miss an event the list still refreshes on its
    // own.
    staleTime: 30_000,
  });

  const all = data ?? [];
  // Rendered client-side after the query resolves, so reading the clock here
  // is stable enough (a row crossing "now" just moves on the next refetch).
  const nowIso = new Date().toISOString();
  const isUpcoming = (m: RecentMeeting) =>
    !m.ended_at && m.scheduled_start !== null && m.scheduled_start > nowIso;
  const upcoming = all
    .filter(isUpcoming)
    .sort((a, b) => a.scheduled_start!.localeCompare(b.scheduled_start!))
    .slice(0, 5);
  const meetings = all.filter((m) => !isUpcoming(m)).slice(0, 12);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={base} />}
                isActive={onIndex}
                tooltip="All meetings"
              >
                <Video />
                <span>All meetings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`${base}?schedule=1`} />}
                tooltip="Schedule meeting"
              >
                <CalendarPlus />
                <span>Schedule meeting</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {upcoming.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Upcoming</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {upcoming.map((m) => (
                <SidebarMenuItem key={m.id}>
                  <SidebarMenuButton
                    render={<Link href={`${base}/${m.id}`} />}
                    isActive={pathname === `${base}/${m.id}`}
                    tooltip={m.title}
                    size="sm"
                  >
                    <CalendarClock />
                    <span className="truncate">{m.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}

      <SidebarGroup>
        <SidebarGroupLabel>Recent</SidebarGroupLabel>
        <SidebarGroupContent>
          {meetings.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-faint-foreground">
              No meetings yet. Start one from a channel&apos;s{" "}
              <strong>Meet</strong> button, or schedule one above.
            </p>
          ) : (
            <SidebarMenu>
              {meetings.map((m) => (
                <SidebarMenuItem key={m.id}>
                  <SidebarMenuButton
                    render={<Link href={`${base}/${m.id}`} />}
                    isActive={pathname === `${base}/${m.id}`}
                    tooltip={m.title}
                    size="sm"
                  >
                    {m.has_summary ? (
                      // A summarized meeting is marked by the icon SHAPE
                      // alone. Notion nav rows carry no colored icons, and
                      // the old `text-indigo-400` never rendered anyway (the
                      // row's own `[&_svg]:text-sidebar-foreground/70` out-
                      // specifies a plain utility class).
                      <Sparkles />
                    ) : (
                      <Video />
                    )}
                    <span className="truncate">{m.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
