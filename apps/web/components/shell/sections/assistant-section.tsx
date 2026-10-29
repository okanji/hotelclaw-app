"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, Search, SquarePen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  assistantChatsKey,
  assistantChatsQueryOptions,
  assistantProjectsKey,
  assistantProjectsQueryOptions,
} from "@/lib/query/assistant-queries";
import { asTint } from "@/lib/assistant/types";
import { Gi } from "@/components/gr8r/icon";
import { tintVar } from "@/components/gr8r/ai-glyphs";

/**
 * Secondary sidebar for the Assistant section — new chat, then projects
 * (a few recent rows, "+" in the group header, "All projects" as the way
 * in), then the recents list.
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
      <Link
        href={base}
        className={pathname === base ? "sitem on" : "sitem"}
        title="Start a new conversation"
        aria-current={pathname === base ? "page" : undefined}
      >
        <Gi icon={SquarePen} />
        <span className="trunc">New chat</span>
      </Link>

      <div className="sgroup" style={{ marginTop: 8 }}>
        <div className="sgroup-h">
          <span className="trunc">Projects</span>
          <Link
            href={`${projectsBase}?new=1`}
            className="ibtn ibtn-xs"
            title="New project"
            aria-label="New project"
            style={{ marginLeft: "auto" }}
          >
            <Gi icon={Plus} size={13} />
          </Link>
        </div>
        {projects.slice(0, 5).map((project) => {
          const href = `${projectsBase}/${project.id}`;
          return (
            <Link
              key={project.id}
              href={href}
              className={pathname === href ? "sitem on" : "sitem"}
              title={project.name}
              aria-current={pathname === href ? "page" : undefined}
            >
              <span className="pico" style={tintVar(asTint(project.tint))}>
                <span style={{ fontSize: 10, lineHeight: 1 }}>{project.emoji}</span>
              </span>
              <span className="trunc">{project.name}</span>
            </Link>
          );
        })}
        <Link
          href={projectsBase}
          className={pathname === projectsBase ? "sitem on" : "sitem"}
          title="Standing work with its own instructions and memory"
          aria-current={pathname === projectsBase ? "page" : undefined}
        >
          <Gi icon={FolderOpen} />
          <span className="trunc">All projects</span>
          {projects.length > 5 ? <span className="ct">{projects.length}</span> : null}
        </Link>
      </div>

      <div className="sgroup" style={{ marginTop: 8 }}>
        <div className="sgroup-h">
          <span className="trunc">Recents</span>
        </div>
        {chats.length > 8 ? (
          <div className="inwrap" style={{ margin: "2px 0 4px" }}>
            <Gi icon={Search} size={13} />
            <input
              type="search"
              value={chatFilter}
              onChange={(e) => setChatFilter(e.target.value)}
              placeholder="Filter conversations…"
              aria-label="Filter conversations"
              className="input"
              style={{ height: 28, fontSize: "var(--g8-fs-sm)" }}
            />
          </div>
        ) : null}
        {chats.length === 0 ? (
          <p className="faint" style={{ padding: "4px 8px", fontSize: "var(--g8-fs-xs)", margin: 0 }}>
            No conversations yet.
          </p>
        ) : filteredChats.length === 0 ? (
          <p className="faint" style={{ padding: "4px 8px", fontSize: "var(--g8-fs-xs)", margin: 0 }}>
            Nothing matches.
          </p>
        ) : (
          filteredChats.slice(0, 25).map((chat) => (
            // A real navigation here, not the workspace's pushState: the
            // sidebar can be clicked from a project page too, and the
            // destination has to mount the workspace either way.
            <Link
              key={chat.id}
              href={`${base}?c=${chat.id}`}
              className="sitem"
              title={chat.title}
            >
              <span className="trunc">{chat.title}</span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
