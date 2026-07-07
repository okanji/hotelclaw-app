"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutGrid,
  UserCircle,
  Power,
  FileEdit,
  AlertTriangle,
  Sparkles,
  History,
  Database,
  LibraryBig,
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
 * Secondary sidebar for the Workflows section. Pinned views (All / Mine /
 * Active / Drafts / Failing) + library entries (Templates, Runs, Entities).
 *
 * Saved views use ?view= so the list page can switch filters without a route
 * change.
 */
export function WorkflowsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/p/${propertyId}/workflows`;
  const onList = pathname === base;
  const view = params.get("view") ?? "all";

  const pinned = [
    { id: "all", label: "All workflows", icon: LayoutGrid },
    { id: "mine", label: "My workflows", icon: UserCircle },
    { id: "active", label: "Active", icon: Power },
    { id: "drafts", label: "Drafts", icon: FileEdit },
    { id: "failing", label: "Failing", icon: AlertTriangle },
  ] as const;

  const library = [
    { label: "Templates", icon: LibraryBig, href: `${base}/templates` },
    { label: "Runs", icon: History, href: `${base}/runs` },
    { label: "Entities", icon: Database, href: `${base}/entities` },
  ];

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Workflows</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`${base}/new`} />}
                tooltip="Build a workflow with AI"
              >
                <Sparkles />
                <span>Build with AI</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {pinned.map((v) => {
              const href = v.id === "all" ? base : `${base}?view=${v.id}`;
              const active = onList && view === v.id;
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
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Library</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {library.map((v) => {
              const active = pathname.startsWith(v.href);
              return (
                <SidebarMenuItem key={v.label}>
                  <SidebarMenuButton
                    render={<Link href={v.href} />}
                    isActive={active}
                    tooltip={v.label}
                  >
                    <v.icon />
                    <span>{v.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
