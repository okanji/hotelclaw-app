"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, ShieldCheck } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Secondary sidebar for the Agents section. ?view= switches list filters
 * without a route change (chatbots pattern); "Built-in AI" scrolls the same
 * list page to the transparency half.
 */
export function AgentsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/p/${propertyId}/agents`;
  const onList = pathname === base;
  const view = params.get("view") ?? "all";

  return (
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
  );
}
