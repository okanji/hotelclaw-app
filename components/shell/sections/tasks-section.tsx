"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutGrid, UserCheck } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Secondary-sidebar content for the Tasks section: saved views over the same
 * Kanban board. "My tasks" passes `?view=mine`, which `tasks/board.tsx`
 * filters by the current user's assignments.
 *
 * Uses `useSearchParams` for the active highlight — wrap in `<Suspense>`.
 */
export function TasksSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/p/${propertyId}/tasks`;
  const onTasks = pathname === base || pathname.startsWith(`${base}/`);
  const mine = searchParams.get("view") === "mine";

  const views = [
    {
      label: "All tasks",
      icon: LayoutGrid,
      href: base,
      active: onTasks && !mine,
    },
    {
      label: "My tasks",
      icon: UserCheck,
      href: `${base}?view=mine`,
      active: onTasks && mine,
    },
  ];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Tasks</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {views.map((v) => (
            <SidebarMenuItem key={v.label}>
              <SidebarMenuButton
                render={<Link href={v.href} />}
                isActive={v.active}
                tooltip={v.label}
              >
                <v.icon />
                <span>{v.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
