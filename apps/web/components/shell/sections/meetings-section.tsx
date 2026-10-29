"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarPlus,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
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

  const item = (href: string, label: string, icon: LucideIcon, on: boolean) => (
    <Link
      key={href}
      href={href}
      className={on ? "sitem on" : "sitem"}
      title={label}
      aria-current={on ? "page" : undefined}
    >
      <Gi icon={icon} size={14} />
      <span className="trunc">{label}</span>
    </Link>
  );

  return (
    <>
      {item(base, "All meetings", Video, onIndex)}
      {item(`${base}?schedule=1`, "Schedule meeting", CalendarPlus, false)}

      {upcoming.length > 0 ? (
        <>
          <div className="sgroup-h">Upcoming</div>
          {upcoming.map((m) =>
            item(`${base}/${m.id}`, m.title, CalendarClock, pathname === `${base}/${m.id}`),
          )}
        </>
      ) : null}

      <div className="sgroup-h">Recent</div>
      {meetings.length === 0 ? (
        <p className="hint" style={{ padding: "4px 8px" }}>
          No meetings yet. Start one from a channel&apos;s <strong>Meet</strong>{" "}
          button, or schedule one above.
        </p>
      ) : (
        // A summarized meeting is marked by the icon SHAPE alone (Sparkles).
        meetings.map((m) =>
          item(
            `${base}/${m.id}`,
            m.title,
            m.has_summary ? Sparkles : Video,
            pathname === `${base}/${m.id}`,
          ),
        )
      )}
    </>
  );
}
