import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded } from "@/lib/auth/onboarding";
import { LeftShell } from "@/components/shell/left-shell";
import { ShellSectionProvider } from "@/components/shell/shell-section-context";
import { BrowserNotifications } from "@/components/chat/inbox/browser-notifications";
import { SidebarProvider } from "@/components/ui/sidebar";
import { StreamProvider } from "@/lib/stream/client-provider";
import { StreamVideoProvider } from "@/lib/stream/video-provider";
import { HuddleProvider } from "@/lib/stream/huddle-context";
import { HuddleWidget } from "@/components/chat/huddle/huddle-widget";
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

  return (
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
      <LiveblocksProviders propertyId={propertyId}>
       <TimeFormatProvider initial={initialTimeFormat}>
        <InfoPanelProvider>
          <UserProfilePanelProvider>
            <CommandPaletteProvider>
              <SidebarProvider>
                <ShellSectionProvider>
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
                        <div className="flex min-w-0 flex-1 flex-col">
                          {children}
                        </div>
                        <UserProfilePanel propertyId={propertyId} />
                      </div>
                    </main>
                  </div>
                  <CommandPalette propertyId={propertyId} />
                  <ChatEventNotifier propertyId={propertyId} />
                  <HuddleWidget />
                  <BrowserNotifications />
                </ShellSectionProvider>
              </SidebarProvider>
            </CommandPaletteProvider>
          </UserProfilePanelProvider>
        </InfoPanelProvider>
       </TimeFormatProvider>
      </LiveblocksProviders>
      </HuddleProvider>
     </StreamVideoProvider>
    </StreamProvider>
  );
}
