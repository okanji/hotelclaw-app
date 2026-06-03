"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarDays,
  FileText,
  Home,
  ListChecks,
  MessagesSquare,
  Video,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type NavItem = {
  label: string;
  icon: LucideIcon;
  path: string;
};

/**
 * Secondary-sidebar content for the Home section: the Home landing plus quick
 * links into every work surface, so the sidebar stays useful while Home is
 * active (mirrors the rail destinations).
 */
export function HomeSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const base = `/p/${propertyId}`;

  const items: NavItem[] = [
    { label: "Home", icon: Home, path: `${base}/home` },
    { label: "Tasks", icon: ListChecks, path: `${base}/tasks` },
    { label: "Docs", icon: FileText, path: `${base}/documents` },
    { label: "Calendar", icon: CalendarDays, path: `${base}/calendar` },
    { label: "Chat", icon: MessagesSquare, path: `${base}/chat` },
    { label: "Workflows", icon: Workflow, path: `${base}/workflows` },
    { label: "Meetings", icon: Video, path: `${base}/meetings` },
    { label: "Activity", icon: Bell, path: `${base}/activity` },
  ];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Home</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton
                render={<Link href={item.path} />}
                isActive={
                  item.path === `${base}/home`
                    ? pathname === item.path
                    : pathname.startsWith(item.path)
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
  );
}
