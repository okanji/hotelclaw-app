"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Video } from "lucide-react";
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
  has_summary: boolean;
};

/**
 * Secondary-sidebar content for the Meetings section: an "All meetings"
 * jump link plus the 12 most recent meetings as a compact list. The full
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
          "id, title, started_at, ended_at, meeting_summaries(id)",
        )
        .eq("property_id", propertyId)
        .order("started_at", { ascending: false })
        .limit(12);
      if (error) throw new Error(error.message);
      return (data ?? []).map((m) => ({
        id: m.id,
        title: m.title,
        started_at: m.started_at ?? new Date(0).toISOString(),
        ended_at: m.ended_at,
        has_summary: (m.meeting_summaries ?? []).length > 0,
      }));
    },
    // 30s feels right — the realtime channel below pushes inserts faster
    // than this, but if we miss an event the list still refreshes on its
    // own.
    staleTime: 30_000,
  });

  const meetings = data ?? [];

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
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Recent</SidebarGroupLabel>
        <SidebarGroupContent>
          {meetings.length === 0 ? (
            <p className="px-3 py-2 text-xs text-sidebar-foreground/60">
              No meetings yet. Click <strong>Meet</strong> in any channel.
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
                      <Sparkles className="text-indigo-400" />
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
