"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, MessageSquare, Sparkles } from "lucide-react";
import {
  assistantChatsKey,
  assistantChatsQueryOptions,
  assistantProjectsQueryOptions,
} from "@/lib/query/assistant-queries";
import { asTint, type AssistantChat } from "@/lib/assistant/types";
import { TintIcon } from "@/components/ui/tint-card";
import { cn } from "@/lib/utils";
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
        await qc.invalidateQueries({ queryKey: assistantChatsKey(propertyId) });
        openChat(result.chatId, { pending: opts.message });
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
          onSubmit={() => {
            const message = homeInput.trim();
            if (!message) return;
            setHomeInput("");
            void startChat({ message });
          }}
          onOpenChat={(chatId) => openChat(chatId)}
        />
      ) : null}

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
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-content px-6 py-14">
        <h1 className="text-center text-3xl font-semibold tracking-normal text-balance">
          What can I help with?
        </h1>
        <p className="mx-auto mt-2 max-w-md text-center text-base text-pretty text-muted-foreground">
          Your assistant sees everything you do — tasks, documents, the
          calendar, bookings, your conversations, and the property brain.
        </p>

        <AssistantComposer
          size="hero"
          className="mt-7"
          value={input}
          onChange={onInput}
          onSubmit={onSubmit}
          busy={busy}
          autoFocus
        />

        {projects.length > 0 ? (
          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs font-medium text-faint-foreground">Projects</h2>
              <Link
                href={`/p/${propertyId}/assistant/projects`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                All projects
              </Link>
            </div>
            <ul role="list" className="mt-2 grid gap-2 sm:grid-cols-2">
              {projects.slice(0, 4).map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/p/${propertyId}/assistant/projects/${project.id}`}
                    className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                  >
                    <TintIcon tone={asTint(project.tint)} className="text-sm">
                      {project.emoji}
                    </TintIcon>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {project.name}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-faint-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-8">
          <h2 className="text-xs font-medium text-faint-foreground">Recents</h2>
          {recents.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-4 shrink-0 text-faint-foreground" />
              Nothing yet — ask the first question above.
            </p>
          ) : (
            <ul role="list" className="mt-1 flex flex-col">
              {recents.map((chat) => (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => onOpenChat(chat.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
                    )}
                  >
                    <MessageSquare className="size-4 shrink-0 text-faint-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{chat.title}</span>
                    <time
                      className="shrink-0 text-xs text-faint-foreground"
                      dateTime={chat.last_message_at}
                    >
                      {relativeDay(chat.last_message_at)}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
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
