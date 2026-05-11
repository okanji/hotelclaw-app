import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getUserMemberships } from "@/lib/auth/session";
import { isOnboarded } from "@/lib/auth/onboarding";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { StreamProvider } from "@/lib/stream/client-provider";
import { LiveblocksProviders } from "@/lib/liveblocks/room-provider";
import { InfoPanelProvider } from "@/components/chat/info-panel/context";
import { CommandPaletteProvider } from "@/components/shell/command-palette-context";
import { CommandPalette } from "@/components/shell/command-palette";
import { ChatEventNotifier } from "@/components/shell/chat-event-notifier";
import { UserProfilePanelProvider } from "@/components/chat/user-profile-panel/context";
import { UserProfilePanel } from "@/components/chat/user-profile-panel/panel";

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
    .select("id, full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <StreamProvider
      userId={user.id}
      userName={profile.data?.full_name ?? user.email ?? user.id}
      avatarUrl={profile.data?.avatar_url ?? null}
    >
      <LiveblocksProviders propertyId={propertyId}>
        <InfoPanelProvider>
          <UserProfilePanelProvider>
            <CommandPaletteProvider>
              <SidebarProvider>
                <AppSidebar
                  currentPropertyId={propertyId}
                  memberships={memberships}
                  user={{
                    id: user.id,
                    email: user.email ?? "",
                    name: profile.data?.full_name ?? null,
                    avatarUrl: profile.data?.avatar_url ?? null,
                  }}
                />
                <SidebarInset>
                  {/* flex-row so an open profile panel claims width and the
                      chat/tasks/threads page compresses to fit (Slack-style
                      push, not overlay). */}
                  <div className="flex h-full min-h-0 flex-1">
                    <div className="flex min-w-0 flex-1 flex-col">
                      {children}
                    </div>
                    <UserProfilePanel propertyId={propertyId} />
                  </div>
                </SidebarInset>
                <CommandPalette propertyId={propertyId} />
                <ChatEventNotifier propertyId={propertyId} />
              </SidebarProvider>
            </CommandPaletteProvider>
          </UserProfilePanelProvider>
        </InfoPanelProvider>
      </LiveblocksProviders>
    </StreamProvider>
  );
}
