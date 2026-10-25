"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, Network } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ProjectsSidebar } from "@/components/projects/projects-sidebar";

/**
 * Home secondary-sidebar content — ClickUp-style: the Home dashboard and org
 * chart, then the property's structure (Teams, Projects). My tasks and
 * Favorites moved to the You block pinned atop every sidebar
 * (`components/shell/you-block.tsx`), so they aren't repeated here.
 */
export function HomeSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const base = `/p/${propertyId}`;

  const quickLinks = [
    { label: "Home", icon: FolderKanban, href: `${base}/home`, match: `${base}/home` },
    {
      label: "Org chart",
      icon: Network,
      href: `${base}/home/org`,
      match: `${base}/home/org`,
    },
  ];

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {quickLinks.map((item) => (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  render={<Link href={item.href} />}
                  isActive={
                    item.match === `${base}/home`
                      ? pathname === item.match
                      : pathname.startsWith(item.match)
                  }
                  tooltip={item.label}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <ProjectsSidebar propertyId={propertyId} />
    </>
  );
}
