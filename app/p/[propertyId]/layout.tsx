import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import { getDocumentsTree } from "@/lib/documents/queries";
import { getNotifications } from "@/lib/notifications/server";
import { requireUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded } from "@/lib/auth/onboarding";
import { LeftShell } from "@/components/shell/left-shell";
import { ShellSectionProvider } from "@/components/shell/shell-section-context";
import { BrowserNotifications } from "@/components/chat/inbox/browser-notifications";
import { ChatSurface } from "@/components/chat/chat-surface";
import { TasksSurface } from "@/components/tasks/tasks-surface";
import { DocumentsSurface } from "@/components/documents/documents-surface";
import { ActivitySurface } from "@/components/shell/activity/activity-surface";
import { ThreadsSurface } from "@/components/chat/threads/threads-surface";
import { InboxSurface } from "@/components/chat/inbox/inbox-surface";
import { SidebarProvider } from "@/components/ui/sidebar";
import { StreamProvider } from "@/lib/stream/client-provider";
import { StreamVideoProvider } from "@/lib/stream/video-provider";
import { HuddleProvider } from "@/lib/stream/huddle-context";
import { HuddleWidget } from "@/components/chat/huddle/huddle-widget";
import { MeetingProvider } from "@/lib/stream/meeting-context";
import { ActiveMeeting } from "@/components/chat/meeting/active-meeting";
import { CalendarPrefsProvider } from "@/components/calendar/calendar-prefs-context";
import { CalendarSurface } from "@/components/calendar/calendar-surface";
import { LiveblocksProviders } from "@/lib/liveblocks/room-provider";
import { InfoPanelProvider } from "@/components/chat/info-panel/context";
import { CommandPaletteProvider } from "@/components/shell/command-palette-context";
import { CommandPalette } from "@/components/shell/command-palette";
import { ChatEventNotifier } from "@/components/shell/chat-event-notifier";
import { UserProfilePanelProvider } from "@/components/chat/user-profile-panel/context";
import { UserProfilePanel } from "@/components/chat/user-profile-panel/panel";
import { TimeFormatProvider } from "@/lib/preferences/time-format-context";
import type { TimeFormat } from "@/lib/auth/profile-actions";

export default async function PropertyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const user = await requireUser();
  if (!(await isOnboarded(user.id))) {
    redirect(`/welcome?next=${encodeURIComponent(`/p/${propertyId}/chat`)}`);
  }
  const supabase = await createClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id, name, slug")
    .eq("id", propertyId)
    .is("archived_at", null)
    .maybeSingle();

  if (!property) notFound();

  const memberships = await getUserMemberships();
  const profile = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, time_format")
    .eq("id", user.id)
    .maybeSingle();

  const initialTimeFormat: TimeFormat =
    profile.data?.time_format === "12h" ? "12h" : "24h";

  // Persisted secondary-sidebar widths — read server-side from cookies so the
  // first paint matches the resized width with no hydration flash. Activity
  // keeps its own (wider) width separate from the chat/tasks/docs sidebar.
  const cookieStore = await cookies();
  const cookieWidth = Number(cookieStore.get("section_sidebar_width")?.value);
  const sectionSidebarWidth = Number.isFinite(cookieWidth)
    ? cookieWidth
    : undefined;
  const activityCookieWidth = Number(
    cookieStore.get("activity_sidebar_width")?.value,
  );
  const activitySidebarWidth = Number.isFinite(activityCookieWidth)
    ? activityCookieWidth
    : undefined;

  // Stream the user's notifications to the client so the Activity feed (rail
  // badge + section) and the Activity page render populated on first paint —
  // the shared `useNotifications` hook hydrates from this.
  const queryClient = getServerQueryClient();
  // Await — see lib/query/client. A bare `void` prefetch leaves the
  // notifications cache empty on hard load so the Activity feed + rail
  // badge would render blank until the rail's client-side prefetch runs.
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["notifications", user.id],
      queryFn: () => getNotifications(supabase, { limit: 100 }),
    }),
    // `<DocumentsSurface>` lives in this layout (outside the documents
    // segment's `HydrationBoundary`), so warm the tree here too — otherwise
    // a hard refresh of `/documents/[id]` can leave `useQuery` fetching with
    // no hydrated data and the editor stuck on "Loading document…".
    queryClient.prefetchQuery({
      queryKey: ["documents-tree", propertyId],
      queryFn: () => getDocumentsTree(supabase, propertyId),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
    <StreamProvider
      userId={user.id}
      userName={profile.data?.full_name ?? user.email ?? user.id}
      avatarUrl={profile.data?.avatar_url ?? null}
    >
     <StreamVideoProvider
      userId={user.id}
      userName={profile.data?.full_name ?? user.email ?? user.id}
      avatarUrl={profile.data?.avatar_url ?? null}
     >
      <HuddleProvider>
      <MeetingProvider>
      <CalendarPrefsProvider>
      <LiveblocksProviders propertyId={propertyId}>
       <TimeFormatProvider initial={initialTimeFormat}>
        <InfoPanelProvider>
          <UserProfilePanelProvider>
            <CommandPaletteProvider>
              <SidebarProvider>
                <ShellSectionProvider
                  initialSection={cookieStore.get("shell_section")?.value}
                >
                  {/* Slack-style shell: icon rail + contextual secondary
                      sidebar (both bg-sidebar, no divider) + inset content. */}
                  <div className="flex h-svh w-full overflow-hidden bg-sidebar">
                    <LeftShell
                      currentPropertyId={propertyId}
                      memberships={memberships}
                      defaultWidth={sectionSidebarWidth}
                      activityDefaultWidth={activitySidebarWidth}
                      user={{
                        id: user.id,
                        email: user.email ?? "",
                        name: profile.data?.full_name ?? null,
                        avatarUrl: profile.data?.avatar_url ?? null,
                      }}
                    />
                    <main
                      data-slot="sidebar-inset"
                      className="relative m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border"
                    >
                      {/* flex-row so an open profile panel claims width and the
                          chat/tasks/threads page compresses to fit (Slack-style
                          push, not overlay). */}
                      <div className="flex h-full min-h-0 flex-1">
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                          {/* Persistent section surfaces. Each renders only
                              when its URL prefix matches and returns null
                              otherwise, so rail clicks between sections become
                              zero-roundtrip `pushState`s instead of cross-
                              segment Next route navigations. `children` stays
                              as the fallback for the `/chat` index — its
                              `page.tsx` still server-redirects to the first
                              channel (or renders "No channels yet"), which a
                              `pushState` can't trigger. Every other section's
                              `page.tsx` is `null` and the surface here owns
                              rendering. */}
                          {children}
                          <ChatSurface propertyId={propertyId} />
                          <TasksSurface
                            propertyId={propertyId}
                            currentUserId={user.id}
                          />
                          <CalendarSurface
                            propertyId={propertyId}
                            currentUserId={user.id}
                          />
                          <DocumentsSurface propertyId={propertyId} />
                          <ActivitySurface
                            propertyId={propertyId}
                            userId={user.id}
                            userName={profile.data?.full_name ?? null}
                          />
                          <ThreadsSurface />
                          <InboxSurface
                            propertyId={propertyId}
                            userId={user.id}
                          />
                        </div>
                        <UserProfilePanel propertyId={propertyId} />
                      </div>
                    </main>
                  </div>
                  <CommandPalette propertyId={propertyId} />
                  <ChatEventNotifier propertyId={propertyId} />
                  <HuddleWidget />
                  <ActiveMeeting />
                  <BrowserNotifications />
                </ShellSectionProvider>
              </SidebarProvider>
            </CommandPaletteProvider>
          </UserProfilePanelProvider>
        </InfoPanelProvider>
       </TimeFormatProvider>
      </LiveblocksProviders>
      </CalendarPrefsProvider>
      </MeetingProvider>
      </HuddleProvider>
     </StreamVideoProvider>
    </StreamProvider>
    </HydrationBoundary>
  );
}
