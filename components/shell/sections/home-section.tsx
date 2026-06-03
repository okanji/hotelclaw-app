"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  FolderKanban,
  Inbox,
  ListChecks,
  UserCheck,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { documentsQueryOptions } from "@/lib/query/section-queries";
import { usePinnedDocs } from "@/lib/documents/use-pinned-docs";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { ProjectsSidebar } from "@/components/projects/projects-sidebar";

/**
 * Home secondary-sidebar content — ClickUp-style. A few work-centric quick
 * links, the user's Favorites (their personally-pinned docs), and a Projects
 * section. Projects is the home for the upcoming Projects feature (teams +
 * cross-team initiatives); until that ships it shows a ready placeholder.
 *
 * Personal *activity* now lives as its own widget on the dashboard, not here.
 */
export function HomeSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const base = `/p/${propertyId}`;
  const openDocument = useOpenDocument(propertyId);

  const { pinnedIds } = usePinnedDocs(propertyId);
  const { data: docs = [] } = useQuery(documentsQueryOptions(propertyId));
  const favorites = useMemo(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    return pinnedIds
      .map((id) => byId.get(id))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .slice(0, 8);
  }, [pinnedIds, docs]);

  const quickLinks = [
    { label: "Home", icon: FolderKanban, href: `${base}/home`, match: `${base}/home` },
    {
      label: "My tasks",
      icon: UserCheck,
      href: `${base}/tasks?view=mine`,
      match: `${base}/tasks`,
    },
    { label: "All tasks", icon: ListChecks, href: `${base}/tasks`, match: `${base}/tasks` },
    { label: "Inbox", icon: Inbox, href: `${base}/activity`, match: `${base}/activity` },
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

      <SidebarGroup>
        <SidebarGroupLabel>Favorites</SidebarGroupLabel>
        <SidebarGroupContent>
          {favorites.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-pretty text-sidebar-foreground/60">
              Star a document to keep it here.
            </p>
          ) : (
            <SidebarMenu>
              {favorites.map((d) => (
                <SidebarMenuItem key={d.id}>
                  <SidebarMenuButton
                    render={<button type="button" />}
                    onClick={() => openDocument(d.id)}
                    tooltip={d.title || "Untitled"}
                  >
                    <FileText />
                    <span className="truncate">{d.title || "Untitled"}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <ProjectsSidebar propertyId={propertyId} />
    </>
  );
}
