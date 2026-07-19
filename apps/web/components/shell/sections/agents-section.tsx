"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Brain,
  Inbox,
  LayoutGrid,
  MessagesSquare,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  pendingApprovalsCountQueryOptions,
  podQueryOptions,
} from "@/lib/query/fleet-queries";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Secondary sidebar for the Agents section. ?view= switches list filters
 * without a route change (chatbots pattern); "Built-in AI" scrolls the same
 * list page to the transparency half.
 *
 * The Fleet group (pod bots / sessions / approvals / brain) renders only
 * for properties that belong to a client (pod). It owns the Realtime
 * invalidation for the approvals count + sessions list — push via
 * postgres_changes on bot_chat_sessions, never polling.
 */
export function AgentsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const base = `/p/${propertyId}/agents`;
  const fleetBase = `${base}/fleet`;
  const onList = pathname === base;
  const view = params.get("view") ?? "all";

  const { data: pod } = useQuery(podQueryOptions(propertyId));
  const { data: approvalsCount = 0 } = useQuery({
    ...pendingApprovalsCountQueryOptions(propertyId),
    enabled: Boolean(pod),
  });

  useEffect(() => {
    if (!pod) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`fleet:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bot_chat_sessions",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          void qc.invalidateQueries({
            queryKey: ["fleet-approvals-count", propertyId],
          });
          void qc.invalidateQueries({ queryKey: ["fleet-sessions", propertyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pod, propertyId, qc]);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Agents</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`${base}?new=1`} />}
                tooltip="Create an agent"
              >
                <Plus />
                <span>New agent</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={base} />}
                isActive={onList && view === "all"}
                tooltip="Your agents"
              >
                <LayoutGrid />
                <span>Your agents</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`${base}?view=builtin`} />}
                isActive={onList && view === "builtin"}
                tooltip="Every built-in AI in the app"
              >
                <ShieldCheck />
                <span>Built-in AI</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {pod ? (
        <SidebarGroup>
          <SidebarGroupLabel>Fleet · {pod.name}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={fleetBase} />}
                  isActive={pathname === fleetBase || /\/fleet\/[0-9a-f-]{36}$/.test(pathname)}
                  tooltip="The pod bots serving this property"
                >
                  <Bot />
                  <span>Pod bots</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`${fleetBase}/sessions`} />}
                  isActive={pathname === `${fleetBase}/sessions`}
                  tooltip="Chat sessions and workflow runs"
                >
                  <MessagesSquare />
                  <span>Sessions</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`${fleetBase}/approvals`} />}
                  isActive={pathname === `${fleetBase}/approvals`}
                  tooltip="Gated actions waiting on a human"
                >
                  <Inbox />
                  <span>Approvals</span>
                </SidebarMenuButton>
                {approvalsCount > 0 ? (
                  <SidebarMenuBadge>{approvalsCount}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`${fleetBase}/brain`} />}
                  isActive={pathname === `${fleetBase}/brain`}
                  tooltip="Knowledge brain status and API access"
                >
                  <Brain />
                  <span>Brain &amp; access</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}
