"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutGrid,
  Globe,
  FileEdit,
  MessagesSquare,
  Plus,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Secondary sidebar for the Chatbots section. Saved views use ?view= so the
 * list page can switch filters without a route change (workflows pattern).
 */
export function ChatbotsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/p/${propertyId}/chatbots`;
  const onList = pathname === base;
  const view = params.get("view") ?? "all";

  // A chatbot editor route (/chatbots/<botId>/...) has no sidebar item of its
  // own — keep its parent lit rather than leaving the sidebar unselected.
  const sub = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split("/")[0]
    : null;
  const onEditor = sub !== null && sub !== "conversations";

  const pinned = [
    { id: "all", label: "All chatbots", icon: LayoutGrid },
    { id: "published", label: "Live", icon: Globe },
    { id: "drafts", label: "Drafts", icon: FileEdit },
  ] as const;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Chatbots</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={`${base}?new=1`} />}
              tooltip="Create a chatbot"
            >
              <Plus />
              <span>New chatbot</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {pinned.map((v) => {
            const href = v.id === "all" ? base : `${base}?view=${v.id}`;
            const active =
              (onList && view === v.id) || (onEditor && v.id === "all");
            return (
              <SidebarMenuItem key={v.id}>
                <SidebarMenuButton
                  render={<Link href={href} />}
                  isActive={active}
                  tooltip={v.label}
                >
                  <v.icon />
                  <span>{v.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={`${base}/conversations`} />}
              isActive={pathname.startsWith(`${base}/conversations`)}
              tooltip="Guest conversations"
            >
              <MessagesSquare />
              <span>Conversations</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
