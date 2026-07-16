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
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { ShellSectionProvider } from "@/components/shell/shell-section-context";
import { BrowserNotifications } from "@/components/chat/inbox/browser-notifications";
import { HomeSurface } from "@/components/home/home-surface";
import { MyTasksSurface } from "@/components/tasks/my-tasks-surface";
import { ChatSurface } from "@/components/chat/chat-surface";
import { TasksSurface } from "@/components/tasks/tasks-surface";
import { DocumentsSurface } from "@/components/documents/documents-surface";
import { ActivitySurface } from "@/components/shell/activity/activity-surface";
import { ThreadsSurface } from "@/components/chat/threads/threads-surface";
import { InboxSurface } from "@/components/chat/inbox/inbox-surface";
import { WorkflowsSurface } from "@/components/workflows/workflows-surface";
import { SpacesSurface } from "@/components/spaces/spaces-surface";
import { ProjectsSurface } from "@/components/projects/projects-surface";
import { InsightsSurface } from "@/components/insights/insights-surface";
import { OrgSurface } from "@/components/org/org-surface";
import { InsightsTabProvider } from "@/components/insights/insights-tab-context";
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
import { ConnectionStatus } from "@/components/shell/connection-status";
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
    redirect(`/welcome?next=${encodeURIComponent(`/p/${propertyId}/home`)}`);
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
  const currentRole = memberships.find(
    (m) => m.property_id === propertyId,
  )?.role;
  const isManagement = currentRole === "owner" || currentRole === "manager";
  const profile = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, time_format")
    .eq("id", user.id)
    .maybeSingle();

  const initialTimeFormat: TimeFormat =
    profile.data?.time_format === "12h" ? "12h" : "24h";

  const cookieStore = await cookies();

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
                  initialCollapsed={
                    cookieStore.get("sidebar_collapsed")?.value === "1"
                  }
                >
                 <InsightsTabProvider>
                  {/* ClickUp-style shell: floating dark icon rail (m-2 card,
                      see AppRail) beside ONE joined card = secondary sidebar
                      + content pane, connected flush with a shared hairline
                      seam (the main pane's border-l). When the sidebar is
                      collapsed the main pane rounds its left corners back via
                      the LeftShell peer's data-sidebar-open attribute.
                      Below md: the rail/sidebar move into a drawer behind the
                      MobileTopBar hamburger and the content goes full-bleed. */}
                  <div className="flex h-svh w-full flex-col overflow-hidden bg-card">
                    <MobileTopBar
                      currentPropertyId={propertyId}
                      memberships={memberships}
                      propertyName={property.name}
                      user={{
                        id: user.id,
                        email: user.email ?? "",
                        name: profile.data?.full_name ?? null,
                        avatarUrl: profile.data?.avatar_url ?? null,
                      }}
                    />
                    <div className="flex min-h-0 flex-1">
                    <LeftShell
                      className="peer max-md:hidden"
                      currentPropertyId={propertyId}
                      memberships={memberships}
                      user={{
                        id: user.id,
                        email: user.email ?? "",
                        name: profile.data?.full_name ?? null,
                        avatarUrl: profile.data?.avatar_url ?? null,
                      }}
                    />
                    <main
                      data-slot="sidebar-inset"
                      // The rounded corners here are VISUAL ONLY — this element
                      // must never clip (no overflow-hidden): a border-radius
                      // clip over composited scroll containers (kanban columns,
                      // chat lists) trips a Chrome/macOS GPU rasterization bug
                      // where the pane's tiles go white until a scroll forces a
                      // re-raster. Clipping happens on the inner wrapper below
                      // as a plain rectangle instead. The pane's background is
                      // bg-card on a bg-card shell, so content painting square
                      // into the few corner px is invisible. (History: a
                      // transform-gpu layer-promotion hack lived here to paper
                      // over the same bug; it broke position:fixed descendants
                      // and stopped working on Chrome 149 — don't bring it
                      // back.)
                      className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card peer-data-[sidebar-open]:rounded-l-none max-md:m-0 max-md:rounded-none max-md:border-0"
                    >
                      {/* Rectangular clip for the pane's content (see comment
                          above — the radius must not participate in clipping).
                          flex-row so an open profile panel claims width and the
                          chat/tasks/threads page compresses to fit (Slack-style
                          push, not overlay). */}
                      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
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
                          <HomeSurface
                            propertyId={propertyId}
                            propertyName={property.name}
                            userId={user.id}
                            userName={profile.data?.full_name ?? null}
                          />
                          <MyTasksSurface
                            propertyId={propertyId}
                            userId={user.id}
                            userName={profile.data?.full_name ?? null}
                          />
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
                          <WorkflowsSurface propertyId={propertyId} />
                          <SpacesSurface propertyId={propertyId} />
                          <ProjectsSurface propertyId={propertyId} />
                          <InsightsSurface
                            propertyId={propertyId}
                            userId={user.id}
                          />
                          <OrgSurface
                            propertyId={propertyId}
                            propertyName={property.name}
                            isManagement={isManagement}
                          />
                          <ActivitySurface
                            propertyId={propertyId}
                            userId={user.id}
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
                  </div>
                  <CommandPalette propertyId={propertyId} />
                  <ChatEventNotifier propertyId={propertyId} />
                  <ConnectionStatus />
                  <HuddleWidget />
                  <ActiveMeeting />
                  <BrowserNotifications />
                 </InsightsTabProvider>
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
