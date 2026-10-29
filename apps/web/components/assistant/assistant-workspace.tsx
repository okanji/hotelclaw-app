"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, FolderOpen, MessageSquare, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { NewIcon } from "@/components/shell/clickup-icons";
import {
  assistantChatsKey,
  assistantChatsQueryOptions,
  assistantProjectsQueryOptions,
} from "@/lib/query/assistant-queries";
import { asTint, type AssistantChat } from "@/lib/assistant/types";
import { Gi } from "@/components/gr8r/icon";
import { tintVar } from "@/components/gr8r/ai-glyphs";
import { ArtifactSidePanel } from "@/components/chat/artifact-side-panel";
import { AssistantChat as ChatPane } from "./assistant-chat";
import { AssistantComposer } from "./assistant-composer";
import { ChatTabs, type ChatTab } from "./chat-tabs";
import { createChat } from "./actions";

/**
 * The Assistant surface: a tab strip over a set of mounted conversation panes,
 * with a home screen when nothing is open.
 *
 * NAVIGATION IS NOT ROUTING. Switching tabs writes `?c=<chatId>` with
 * `history.pushState` rather than `router.push`, for the same reason the rail
 * does it: a real navigation would tear down and re-attach every pane's event
 * stream, which is precisely the cost tabs exist to avoid. Back/forward still
 * work — a popstate listener reads the param back.
 *
 * Which tabs are open is a per-BROWSER concern — a window's worth of state,
 * like a browser's own tabs — so it rides in a cookie rather than in the
 * database. A COOKIE and not localStorage, deliberately: the server reads it
 * while rendering, so the strip paints correct on the first frame instead of
 * flashing empty and then filling in from an effect. The conversations
 * themselves are durable; their arrangement on this screen is not.
 */

/** Bounded so the cookie stays small and the strip stays legible. */
const MAX_OPEN_TABS = 12;

/**
 * Put a just-created chat at the top of the cached list so the pane that
 * renders from that list exists immediately. Shared with the project page,
 * which hands off to this workspace through a real navigation and would
 * otherwise land on a tab whose row the stale cache does not hold yet.
 */
export function seedChat(
  qc: QueryClient,
  propertyId: string,
  chat: { id: string; title: string; project_id: string | null },
) {
  const now = new Date().toISOString();
  const row: AssistantChat = {
    id: chat.id,
    title: chat.title,
    project_id: chat.project_id,
    eve_session_id: null,
    continuation_token: null,
    pinned: false,
    source: "user",
    workflow_id: null,
    last_message_at: now,
    created_at: now,
  };
  qc.setQueryData<AssistantChat[]>(assistantChatsKey(propertyId), (prev) =>
    prev?.some((c) => c.id === row.id) ? prev : [row, ...(prev ?? [])],
  );
}

export function AssistantWorkspace({
  propertyId,
  initialChats,
  initialOpenIds,
  initialActiveId,
  initialSend,
}: {
  propertyId: string;
  initialChats: AssistantChat[];
  /** Restored server-side from the `assistant_tabs` cookie. */
  initialOpenIds: string[];
  /** `?c=` — the tab to focus. */
  initialActiveId: string | null;
  /** `?send=` — a first message handed over from a project's composer. */
  initialSend: string | null;
}) {
  const qc = useQueryClient();
  const { data: chats = initialChats } = useQuery({
    ...assistantChatsQueryOptions(propertyId),
    initialData: initialChats,
  });
  const { data: projects = [] } = useQuery(assistantProjectsQueryOptions(propertyId));

  const [openIds, setOpenIds] = useState<string[]>(initialOpenIds);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [homeInput, setHomeInput] = useState("");
  const [creating, setCreating] = useState(false);
  // First message for a chat opened from the home composer or a project's
  // handoff, handed to the pane on mount. STATE, not a ref: it is read while
  // rendering the pane list, and a ref read during render is exactly the kind
  // that silently fails to update.
  const [pending, setPending] = useState<Record<string, string>>(() =>
    initialActiveId && initialSend?.trim()
      ? { [initialActiveId]: initialSend }
      : {},
  );

  const chatById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  );

  // Drop `?send=` from the address bar once it has been handed to the pane,
  // so a refresh can never re-send it. Pure external-system write.
  useEffect(() => {
    if (!initialSend) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("send")) return;
    url.searchParams.delete("send");
    window.history.replaceState(null, "", url.toString());
  }, [initialSend]);

  // Persist the arrangement. Also an external-system write, and the only
  // place the cookie is set.
  useEffect(() => {
    // NOT encodeURIComponent'd. The value is a comma-joined list of UUIDs —
    // every character is already cookie-safe — and encoding turns the
    // separators into `%2C`, which the server's `split(",")` then reads as one
    // long unmatchable id. The symptom was subtle: tabs survived a soft switch
    // and silently vanished on any real navigation.
    document.cookie = `assistant_tabs=${openIds
      .slice(0, MAX_OPEN_TABS)
      .join(",")}; path=/; max-age=31536000; SameSite=Lax`;
  }, [openIds]);

  // Keep the URL in step without routing, and honour back/forward.
  const syncUrl = useCallback((chatId: string | null, push: boolean) => {
    const url = new URL(window.location.href);
    if (chatId) url.searchParams.set("c", chatId);
    else url.searchParams.delete("c");
    const method = push ? "pushState" : "replaceState";
    window.history[method](null, "", url.toString());
  }, []);

  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get("c");
      setActiveId(id && openIds.includes(id) ? id : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openIds]);

  // A REAL navigation into this surface (sidebar recents, a project's
  // conversation link) arrives through the router, so `useSearchParams` sees
  // it. This workspace's own tab switches use `pushState`, which deliberately
  // does NOT update that hook — which is exactly what makes the "changed since
  // last router value" test below safe: it can never yank a tab back.
  //
  // Adjusted DURING RENDER on a changed value — React's sanctioned pattern
  // (https://react.dev/learn/you-might-not-need-an-effect), the same one
  // ShellSectionProvider uses to follow navigations. An effect here would
  // paint the old tab first and then jump.
  const searchParams = useSearchParams();
  const routerChatId = searchParams.get("c");
  const [lastRouterChat, setLastRouterChat] = useState<string | null>(initialActiveId);
  if (routerChatId !== lastRouterChat) {
    setLastRouterChat(routerChatId);
    if (routerChatId && chatById.has(routerChatId)) {
      if (!openIds.includes(routerChatId)) {
        setOpenIds([...openIds, routerChatId].slice(-MAX_OPEN_TABS));
      }
      setActiveId(routerChatId);
    } else if (!routerChatId) {
      // Navigated to the bare `/assistant` — that is the sidebar's "New chat"
      // entry, and it should land on the home screen rather than leaving
      // whichever tab happened to be focused in view. Open tabs stay open.
      setActiveId(null);
    }
  }

  const openChat = useCallback(
    (chatId: string, opts: { pending?: string } = {}) => {
      const first = opts.pending;
      if (first) setPending((prev) => ({ ...prev, [chatId]: first }));
      setOpenIds((prev) =>
        prev.includes(chatId) ? prev : [...prev, chatId].slice(-MAX_OPEN_TABS),
      );
      setActiveId(chatId);
      syncUrl(chatId, true);
    },
    [syncUrl],
  );

  const startChat = useCallback(
    async (opts: { message?: string; projectId?: string | null } = {}) => {
      if (creating) return;
      setCreating(true);
      try {
        const result = await createChat({
          propertyId,
          projectId: opts.projectId ?? null,
          title: opts.message?.slice(0, 140),
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        // Seed the cache with the new row and open it IN THE SAME TICK. The
        // first cut awaited a refetch here, which left the person staring at
        // an emptied composer for a round trip and then a blank pane until
        // the list caught up — the message they had just typed looked lost.
        // The background invalidate reconciles the optimistic row.
        seedChat(qc, propertyId, {
          id: result.chatId,
          title: opts.message?.slice(0, 140) || "New chat",
          project_id: opts.projectId ?? null,
        });
        openChat(result.chatId, { pending: opts.message });
        if (opts.message) setHomeInput("");
        void qc.invalidateQueries({ queryKey: assistantChatsKey(propertyId) });
      } finally {
        setCreating(false);
      }
    },
    [creating, openChat, propertyId, qc],
  );

  const closeTab = useCallback(
    (chatId: string) => {
      setOpenIds((prev) => {
        const next = prev.filter((id) => id !== chatId);
        setActiveId((current) => {
          if (current !== chatId) return current;
          const index = prev.indexOf(chatId);
          const fallback = next[index] ?? next[index - 1] ?? null;
          syncUrl(fallback, false);
          return fallback;
        });
        return next;
      });
    },
    [syncUrl],
  );

  const selectTab = useCallback(
    (chatId: string) => {
      setActiveId(chatId);
      syncUrl(chatId, true);
    },
    [syncUrl],
  );

  const goHome = useCallback(() => {
    setActiveId(null);
    syncUrl(null, true);
  }, [syncUrl]);

  const tabs: ChatTab[] = openIds.map((id) => ({
    id,
    title: chatById.get(id)?.title ?? "New chat",
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* With conversations open, the tab strip IS the page's top bar (the
          chat-surface exception, like a channel header). With none open, the
          home screen gets the app-wide compact header. */}
      {openIds.length === 0 ? (
        <PageHeader
          title="Assistant"
          icon={<NewIcon />}
          actions={
            <Link
              href={`/p/${propertyId}/assistant/projects`}
              className="btn btn-ghost btn-sm"
            >
              <Gi icon={FolderOpen} size={14} />
              Projects
            </Link>
          }
        />
      ) : null}
      {openIds.length > 0 ? (
        <ChatTabs
          tabs={tabs}
          activeId={activeId}
          onSelect={selectTab}
          onClose={closeTab}
          onNew={() => void startChat()}
          onReorder={setOpenIds}
        />
      ) : null}

      {/* The panes and the artifact side panel share one row: an artifact
          card (a document the assistant wrote, a task it created) opens the
          same split panel the channel uses, beside the conversation. */}
      <div className="flex min-h-0 flex-1">
      {/* Every open conversation stays mounted; only the active one is shown,
          so a turn running in a background tab keeps streaming. */}
      {openIds.map((id) => {
        const chat = chatById.get(id);
        if (!chat) return null;
        const project = projects.find((p) => p.id === chat.project_id) ?? null;
        return (
          <ChatPane
            key={id}
            propertyId={propertyId}
            chatId={id}
            projectId={chat.project_id}
            projectName={project?.name ?? null}
            initialSession={
              chat.eve_session_id
                ? { id: chat.eve_session_id, continuationToken: chat.continuation_token }
                : null
            }
            pendingMessage={pending[id] ?? null}
            onPendingConsumed={() =>
              setPending((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
              })
            }
            active={id === activeId}
          />
        );
      })}

      {activeId === null ? (
        <AssistantHome
          propertyId={propertyId}
          chats={chats}
          projects={projects}
          input={homeInput}
          onInput={setHomeInput}
          busy={creating}
          // The draft stays in the box until the chat is open — clearing it
          // first made the prompt vanish during the create round trip.
          onSubmit={() => {
            const message = homeInput.trim();
            if (!message) return;
            void startChat({ message });
          }}
          onOpenChat={(chatId) => openChat(chatId)}
        />
      ) : null}
      <ArtifactSidePanel propertyId={propertyId} />
      </div>

      {/* A quiet way back to the home screen while tabs are open. */}
      {activeId !== null && openIds.length > 0 ? (
        <button
          type="button"
          onClick={goHome}
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:rounded-md focus-visible:bg-card focus-visible:px-3 focus-visible:py-1.5 focus-visible:text-sm focus-visible:shadow-popover"
        >
          Back to assistant home
        </button>
      ) : null}
    </div>
  );
}

/**
 * The home screen: one composer and everything you were last working on.
 * Mirrors what a Claude project page opens on — write a message, or pick up
 * a recent thread — because the first question this surface has to answer is
 * "what were we doing", not "what are my settings".
 */
function AssistantHome({
  propertyId,
  chats,
  projects,
  input,
  onInput,
  onSubmit,
  onOpenChat,
  busy,
}: {
  propertyId: string;
  chats: AssistantChat[];
  projects: { id: string; name: string; emoji: string; tint: string }[];
  input: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onOpenChat: (chatId: string) => void;
  busy: boolean;
}) {
  const recents = chats.slice(0, 8);
  // gr8r idiom: a centred `.page` with the hero composer, then two `.panel`
  // lists (projects tiles + recents `.mini` rows).
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="page" style={{ maxWidth: 760, paddingTop: 56 }}>
        <div className="ph" style={{ justifyContent: "center", textAlign: "center" }}>
          <div>
            <h1>What can I help with?</h1>
            <p style={{ maxWidth: 440, marginInline: "auto" }}>
              Your assistant sees everything you do — tasks, documents, the
              calendar, your conversations, and the property brain.
            </p>
          </div>
        </div>

        <AssistantComposer
          size="hero"
          value={input}
          onChange={onInput}
          onSubmit={onSubmit}
          busy={busy}
          autoFocus
        />

        {projects.length > 0 ? (
          <section className="panel" style={{ marginTop: 32 }}>
            <div className="panel-h">
              <h2>Projects</h2>
              <div className="acts">
                <Link
                  href={`/p/${propertyId}/assistant/projects`}
                  className="btn btn-ghost btn-sm"
                >
                  All projects
                </Link>
              </div>
            </div>
            {projects.slice(0, 4).map((project) => (
              <Link
                key={project.id}
                href={`/p/${propertyId}/assistant/projects/${project.id}`}
                className="mini"
              >
                <span
                  className="picon"
                  style={{ ...tintVar(asTint(project.tint)), "--g8-sz": "22px", fontSize: 12 } as React.CSSProperties}
                >
                  {project.emoji}
                </span>
                <span className="tt">{project.name}</span>
                <Gi icon={ArrowRight} size={14} className="faint" />
              </Link>
            ))}
          </section>
        ) : null}

        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h">
            <h2>Recents</h2>
          </div>
          {recents.length === 0 ? (
            <div className="empty-state sm">
              <div className="glyph">
                <Gi icon={Sparkles} />
              </div>
              <p>Nothing yet — ask the first question above.</p>
            </div>
          ) : (
            recents.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => onOpenChat(chat.id)}
                className="mini"
                style={{ width: "100%", textAlign: "left" }}
              >
                <Gi icon={MessageSquare} size={15} className="faint" />
                <span className="tt">{chat.title}</span>
                <time className="due" dateTime={chat.last_message_at}>
                  {relativeDay(chat.last_message_at)}
                </time>
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

/** "6h ago" / "Jul 21" — the same shorthand the recents list in Claude uses. */
function relativeDay(iso: string): string {
  const then = new Date(iso);
  const hours = (Date.now() - then.getTime()) / 3_600_000;
  if (hours < 1) return "Just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 48) return "Yesterday";
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
