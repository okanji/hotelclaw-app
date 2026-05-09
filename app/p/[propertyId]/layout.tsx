import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getUserMemberships } from "@/lib/auth/session";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { StreamProvider } from "@/lib/stream/client-provider";
import { LiveblocksProviders } from "@/lib/liveblocks/room-provider";

export default async function PropertyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const user = await requireUser();
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
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </LiveblocksProviders>
    </StreamProvider>
  );
}
