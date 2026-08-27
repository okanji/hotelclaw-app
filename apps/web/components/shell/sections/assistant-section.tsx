"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, MessageSquare, Plus, Search, SquarePen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  assistantChatsKey,
  assistantChatsQueryOptions,
  assistantProjectsKey,
  assistantProjectsQueryOptions,
} from "@/lib/query/assistant-queries";
import { asTint } from "@/lib/assistant/types";
import { TintIcon } from "@/components/ui/tint-card";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Secondary sidebar for the Assistant section — new chat, projects, and the
 * recents list, in that order: the two things you do and then the thing you
 * come back to.
 *
 * It owns the Realtime invalidation for both assistant tables (0102), so a
 * chat renamed by its first turn, or one started in another tab of the same
 * browser, appears here without a poll.
 */
export function AssistantSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const base = `/p/${propertyId}/assistant`;
  const projectsBase = `${base}/projects`;

  const { data: chats = [] } = useQuery(assistantChatsQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(assistantProjectsQueryOptions(propertyId));
  // Searchable history (Beautiful UI SidebarNav pattern): the filter input
  // appears once the list is long enough that scanning beats scrolling.
  const [chatFilter, setChatFilter] = useState("");
  const filteredChats = chatFilter.trim()
    ? chats.filter((chat) =>
        chat.title.toLowerCase().includes(chatFilter.trim().toLowerCase()),
      )
    : chats;

  useEffect(() => {
    const supabase = createClient();
    // Per-mount topic suffix: a shared topic name crashes on double-mount.
    const channel = supabase
      .channel(`assistant:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "assistant_chats",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: assistantChatsKey(propertyId) });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "assistant_projects",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: assistantProjectsKey(propertyId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Assistant</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={base} />}
                isActive={pathname === base}
                tooltip="Start a new conversation"
              >
                <SquarePen />
                <span>New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={projectsBase} />}
                isActive={pathname.startsWith(projectsBase)}
                tooltip="Standing work with its own instructions and memory"
              >
                <FolderOpen />
                <span>Projects</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {projects.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Your projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.slice(0, 8).map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    render={<Link href={`${projectsBase}/${project.id}`} />}
                    isActive={pathname === `${projectsBase}/${project.id}`}
                    tooltip={project.name}
                  >
                    <TintIcon tone={asTint(project.tint)} className="text-[0.6875rem]">
                      {project.emoji}
                    </TintIcon>
                    <span className="truncate">{project.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`${projectsBase}?new=1`} />}
                  tooltip="Create a project"
                >
                  <Plus />
                  <span>New project</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}

      <SidebarGroup>
        <SidebarGroupLabel>Recents</SidebarGroupLabel>
        <SidebarGroupContent>
          {chats.length > 8 ? (
            <div className="relative mb-1 px-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint-foreground" />
              <input
                type="search"
                value={chatFilter}
                onChange={(e) => setChatFilter(e.target.value)}
                placeholder="Filter conversations…"
                aria-label="Filter conversations"
                className="h-7 w-full rounded-md bg-muted pr-2 pl-7 text-sm outline-none placeholder:text-faint-foreground focus-visible:shadow-ring"
              />
            </div>
          ) : null}
          <SidebarMenu>
            {chats.length === 0 ? (
              <p className="px-2 py-1 text-xs text-faint-foreground">
                No conversations yet.
              </p>
            ) : filteredChats.length === 0 ? (
              <p className="px-2 py-1 text-xs text-faint-foreground">
                Nothing matches.
              </p>
            ) : (
              filteredChats.slice(0, 25).map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <SidebarMenuButton
                    // A real navigation here, not the workspace's pushState:
                    // the sidebar can be clicked from a project page too, and
                    // the destination has to mount the workspace either way.
                    render={<Link href={`${base}?c=${chat.id}`} />}
                    tooltip={chat.title}
                  >
                    <MessageSquare />
                    <span className="truncate">{chat.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
