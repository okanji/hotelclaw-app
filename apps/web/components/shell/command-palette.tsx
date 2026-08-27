"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import type { Channel, MessageResponse } from "stream-chat";
import { useCommandPalette } from "./command-palette-context";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Hash,
  History,
  ListChecks,
  Lock,
  MessageSquareText,
  Search,
  User as UserIcon,
} from "lucide-react";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { cn } from "@/lib/utils";
import {
  loadRecents,
  matchesAction,
  paletteActions,
  recordRecent,
  type PaletteAction,
  type RecentEntry,
} from "./command-palette-actions";

/**
 * Palette chrome — the canonical MODAL tier (docs/notion-spec-v2.md §5/§6).
 *
 * Measured, the Notion search modal is **1006×700**: a wide, tall reading
 * surface, not a 384px dropdown. `DialogContent`'s default `sm:max-w-sm` is
 * what kept ours narrow, so the width is set explicitly here (capped to the
 * viewport). The surface itself — 20px radius, translucent fill, 40px
 * backdrop blur, the two-layer modal shadow and NO ring — is applied by
 * `CommandDialog` after `className`, so this must not try to re-state it.
 */
const PALETTE_PANEL =
  "top-[12vh] w-[min(1006px,calc(100vw-2rem))] max-w-[min(1006px,calc(100vw-2rem))] p-0 sm:max-w-[min(1006px,calc(100vw-2rem))]";

/**
 * Group heading: 12px/12px weight 500 at TERTIARY ink. The search modal's
 * labels sit one rung darker than a sidebar section label (which is faint) —
 * notion-spec-v2 §6 measured `#7d7a75` = `--muted-foreground`.
 */
const PALETTE_GROUP =
  "**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:leading-3 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground";

/** Result row: 28px tall, 6px radius, 14px label, warm fill on selection. */
const PALETTE_ITEM =
  "h-7 rounded-md px-2 py-0 text-sm data-selected:bg-accent";

/** Right-aligned meta on a result row — 12px weight 400 faint. */
const PALETTE_META = "ml-auto shrink-0 text-xs font-normal text-faint-foreground";

type Member = {
  id: string;
  role: string;
  name: string | null;
  avatarUrl: string | null;
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
};

/**
 * Cmd+K / Ctrl+K command palette. Searches across:
 *   - Channels (Stream queryChannels, type=team)
 *   - Direct messages (Stream queryChannels, type=messaging)
 *   - People (this property's members)
 *   - Tasks (this property's tasks)
 *   - Messages (Stream search)
 *
 * Plus two non-search groups (`command-palette-actions.ts`):
 *   - Recent — the last 5 selections, per property in localStorage,
 *     shown only while the query is empty.
 *   - Actions — navigation/creation commands over real routes; shown when
 *     the query is empty or matches an action's label/keywords (this file
 *     runs cmdk with `shouldFilter={false}`, so actions filter themselves).
 *
 * Mounted once at the property layout — the global keyboard listener owns
 * the open state, so any keyboard event in the app can open it.
 */
export function CommandPalette({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const openChannel = useOpenChannel(propertyId);
  const { client } = useChatContext();
  // Single source of truth for open state — the provider owns it so the
  // keyboard shortcut and the sidebar Search button drive the same dialog.
  const { open, setOpen } = useCommandPalette();
  const [query, setQuery] = useState("");

  // Reset query on close so reopening starts fresh.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const me = client?.user?.id;
  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;

  // Recents re-read from localStorage each time the palette opens — the
  // palette closes on every selection, so an open-keyed memo is always
  // current (and `loadRecents` self-guards on the server, returning []).
  const recents = useMemo(
    () => (open ? loadRecents(propertyId) : []),
    [open, propertyId],
  );

  const remember = useCallback(
    (entry: RecentEntry) => recordRecent(propertyId, entry),
    [propertyId],
  );

  const actions = useMemo(() => paletteActions(propertyId), [propertyId]);
  const visibleActions = useMemo(
    () => actions.filter((a) => matchesAction(a, trimmed)),
    [actions, trimmed],
  );

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router],
  );

  // Channel/DM selections route through `openChannel` — a client-side
  // pushState when already in chat, so the palette switch is instant.
  function goChannel(
    channelType: string | undefined,
    channelId: string,
    opts?: { messageId?: string },
  ) {
    setOpen(false);
    openChannel(channelType, channelId, opts);
  }

  // ---- Channels (team) ------------------------------------------------------
  const { data: teamChannels = [] } = useQuery<Channel[]>({
    queryKey: ["cmdk", "team", propertyId, me, trimmed],
    enabled: open && !!client && !!me,
    queryFn: async () => {
      if (!client || !me) return [];
      const filter = {
        type: "team",
        property_id: propertyId,
        members: { $in: [me] },
        ...(hasQuery ? { name: { $autocomplete: trimmed } } : {}),
      };
      return client.queryChannels(
        filter as Parameters<typeof client.queryChannels>[0],
        { last_message_at: -1 },
        { limit: 5 },
      );
    },
  });

  // ---- DMs (messaging) ------------------------------------------------------
  const { data: dmChannels = [] } = useQuery<Channel[]>({
    queryKey: ["cmdk", "dm", propertyId, me, trimmed],
    enabled: open && !!client && !!me,
    queryFn: async () => {
      if (!client || !me) return [];
      const filter = {
        type: "messaging",
        property_id: propertyId,
        members: { $in: [me] },
      };
      const channels = await client.queryChannels(
        filter as Parameters<typeof client.queryChannels>[0],
        { last_message_at: -1 },
        { limit: 20 },
      );
      if (!hasQuery) return channels.slice(0, 5);
      const q = trimmed.toLowerCase();
      return channels
        .filter((c) =>
          dmTitle(c, me).toLowerCase().includes(q),
        )
        .slice(0, 5);
    },
  });

  // ---- People (property members) -------------------------------------------
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["cmdk", "people", propertyId],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/members`, {
        cache: "no-store",
      });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const filteredPeople = useMemo(() => {
    const others = members.filter((m) => m.id !== me);
    if (!hasQuery) return others.slice(0, 5);
    const q = trimmed.toLowerCase();
    return others
      .filter(
        (m) =>
          (m.name ?? "").toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [members, me, hasQuery, trimmed]);

  // ---- Tasks ---------------------------------------------------------------
  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ["cmdk", "tasks", propertyId],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/tasks`, {
        cache: "no-store",
      });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const filteredTasks = useMemo(() => {
    if (!hasQuery) return allTasks.slice(0, 5);
    const q = trimmed.toLowerCase();
    return allTasks
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, 5);
  }, [allTasks, hasQuery, trimmed]);

  // ---- Messages (Stream search) --------------------------------------------
  const { data: messageHits = [] } = useQuery<
    Array<{ message: MessageResponse; channelId: string | undefined }>
  >({
    queryKey: ["cmdk", "messages", propertyId, me, trimmed],
    enabled: open && !!client && !!me && trimmed.length >= 2,
    queryFn: async () => {
      if (!client || !me) return [];
      const res = await client.search(
        {
          type: { $in: ["team", "messaging"] },
          property_id: propertyId,
          members: { $in: [me] },
        } as Parameters<typeof client.search>[0],
        trimmed,
        { limit: 5, sort: [{ created_at: -1 }] },
      );
      return (res.results ?? []).map((r) => ({
        message: r.message as MessageResponse,
        channelId: r.message.cid?.split(":")[1],
      }));
    },
  });

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search channels, people, tasks, and messages, or jump to a section"
      className={PALETTE_PANEL}
    >
      {/* This shadcn build of CommandDialog doesn't wrap children in
          <Command> itself, so cmdk's internal context isn't provided to
          its subcomponents. Wrap explicitly. `shouldFilter={false}` because
          we already do all the filtering server-side per group. */}
      <Command shouldFilter={false} className="rounded-modal p-0">
        <CommandInput
          placeholder="Search channels, people, tasks, messages…"
          value={query}
          onValueChange={setQuery}
        />
        {/* 700px panel − 44px input − 41px footer ≈ 615px of results. */}
        <CommandList className="max-h-[min(615px,60vh)] p-1">
          <CommandEmpty className="py-6 text-center text-sm text-faint-foreground">
            {hasQuery ? "No results." : "Start typing to search."}
          </CommandEmpty>

        {!hasQuery && recents.length > 0 ? (
          <CommandGroup heading="Recent" className={PALETTE_GROUP}>
            {recents.map((entry) => {
              const Icon = recentIcon(entry, actions);
              return (
                <CommandItem
                  key={`recent-${entry.type}-${entry.id ?? entry.href ?? entry.label}`}
                  value={`recent-${entry.type}-${entry.id ?? entry.href ?? entry.label}`}
                  onSelect={() => openRecent(entry)}
                  className={PALETTE_ITEM}
                >
                  <Icon className="size-4 text-faint-foreground" />
                  <span className="truncate">{entry.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {/* No per-row shortcut hints here: none of these actions has a real
            global shortcut (the shell registers only Cmd+K and Cmd+\), and
            the footer already carries the palette's own hints. */}
        {visibleActions.length > 0 ? (
          <CommandGroup heading="Actions" className={PALETTE_GROUP}>
            {visibleActions.map((action) => (
              <CommandItem
                key={action.id}
                value={`action-${action.id}`}
                onSelect={() => {
                  remember({
                    type: "action",
                    id: action.id,
                    label: action.label,
                    href: action.href,
                  });
                  go(action.href);
                }}
                className={PALETTE_ITEM}
              >
                <action.icon className="size-4 text-faint-foreground" />
                <span className="truncate">{action.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {teamChannels.length > 0 ? (
          <CommandGroup heading="Channels" className={PALETTE_GROUP}>
            {teamChannels.map((c) => {
              const data = c.data as
                | { name?: string; is_private?: boolean }
                | undefined;
              const Icon = data?.is_private ? Lock : Hash;
              return (
                <CommandItem
                  key={c.cid}
                  value={`channel-${c.cid}-${data?.name ?? c.id}`}
                  onSelect={() => {
                    remember({
                      type: "channel",
                      id: `${c.type}:${c.id ?? ""}`,
                      label: data?.name ?? c.id ?? "",
                    });
                    goChannel(c.type, c.id ?? "");
                  }}
                  className={PALETTE_ITEM}
                >
                  <Icon className="size-4 text-faint-foreground" />
                  <span className="truncate">{data?.name ?? c.id}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {dmChannels.length > 0 ? (
          <CommandGroup heading="Direct messages" className={PALETTE_GROUP}>
            {dmChannels.map((c) => (
              <CommandItem
                key={c.cid}
                value={`dm-${c.cid}-${dmTitle(c, me)}`}
                onSelect={() => {
                  remember({
                    type: "dm",
                    id: `${c.type}:${c.id ?? ""}`,
                    label: dmTitle(c, me),
                  });
                  goChannel(c.type, c.id ?? "");
                }}
                className={PALETTE_ITEM}
              >
                <DmIcon channel={c} currentUserId={me} />
                <span className="truncate">{dmTitle(c, me)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredPeople.length > 0 ? (
          <CommandGroup heading="People" className={PALETTE_GROUP}>
            {filteredPeople.map((m) => (
              <CommandItem
                key={m.id}
                value={`person-${m.id}-${m.name ?? m.id}`}
                onSelect={() => {
                  remember({
                    type: "person",
                    id: m.id,
                    label: m.name ?? m.id,
                  });
                  void openOrCreateDm(m.id);
                }}
                className={PALETTE_ITEM}
              >
                <Avatar className="size-5">
                  <AvatarImage src={m.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {initialsOf(m.name ?? m.id)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{m.name ?? m.id}</span>
                <span className={cn(PALETTE_META, "capitalize")}>
                  {m.role}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredTasks.length > 0 ? (
          <CommandGroup heading="Tasks" className={PALETTE_GROUP}>
            {filteredTasks.map((t) => (
              <CommandItem
                key={t.id}
                value={`task-${t.id}-${t.title}`}
                onSelect={() => {
                  const href = `/p/${propertyId}/tasks/${t.id}`;
                  remember({ type: "task", id: t.id, label: t.title, href });
                  go(href);
                }}
                className={PALETTE_ITEM}
              >
                <ListChecks className="size-4 text-faint-foreground" />
                <span className="truncate">{t.title}</span>
                <span className={cn(PALETTE_META, "capitalize")}>
                  {t.status.replace("_", " ")}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {messageHits.length > 0 ? (
          <CommandGroup heading="Messages" className={PALETTE_GROUP}>
            {messageHits.map(({ message, channelId }) => (
              <CommandItem
                key={message.id}
                value={`msg-${message.id}-${message.text}`}
                onSelect={() => {
                  if (channelId) {
                    const channelType = message.cid?.split(":")[0];
                    remember({
                      type: "message",
                      id: `${channelType ?? ""}:${channelId}:${message.id}`,
                      label: message.text || "(attachment)",
                    });
                    goChannel(channelType, channelId, {
                      messageId: message.id,
                    });
                  }
                }}
                // Two-line result — the only row that outgrows the 28px pitch.
                className={cn(PALETTE_ITEM, "h-auto items-start py-1.5")}
              >
                <MessageSquareText className="mt-0.5 size-4 text-faint-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {message.text || "(attachment)"}
                  </div>
                  <div className="truncate text-xs text-faint-foreground">
                    {message.user?.name ?? message.user?.id ?? "Someone"}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {hasQuery ? (
          <CommandGroup className={PALETTE_GROUP}>
            <CommandItem
              value={`see-all-results-${trimmed}`}
              onSelect={() =>
                go(`/p/${propertyId}/search?q=${encodeURIComponent(trimmed)}`)
              }
              className={PALETTE_ITEM}
            >
              <Search className="size-4 text-faint-foreground" />
              <span className="truncate">
                See all results for{" "}
                <span className="font-medium text-foreground">
                  &ldquo;{trimmed}&rdquo;
                </span>
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
        </CommandList>

        {/* The measured footer bar (notion-spec-v2 §6): 41px, under a single
            warm hairline, carrying 12px faint shortcut hints. */}
        <CommandFooter className="mx-0 mt-0 mb-0">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            to navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            to open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            to close
          </span>
        </CommandFooter>
      </Command>
    </CommandDialog>
  );

  /**
   * Re-run a recent selection through the same path the original item used
   * (router push, `openChannel`, or DM create) — and re-record it so it
   * moves back to the top of the list.
   */
  function openRecent(entry: RecentEntry) {
    remember(entry);
    switch (entry.type) {
      case "action":
      case "task":
        if (entry.href) go(entry.href);
        break;
      case "channel":
      case "dm": {
        // id is `<channelType>:<channelId>`.
        const sep = (entry.id ?? "").indexOf(":");
        if (sep > 0) {
          goChannel(entry.id!.slice(0, sep), entry.id!.slice(sep + 1));
        }
        break;
      }
      case "message": {
        // id is `<channelType>:<channelId>:<messageId>`.
        const parts = (entry.id ?? "").split(":");
        if (parts.length >= 3) {
          const messageId = parts[parts.length - 1];
          goChannel(parts[0], parts.slice(1, -1).join(":"), { messageId });
        }
        break;
      }
      case "person":
        if (entry.id) void openOrCreateDm(entry.id);
        break;
    }
  }

  /**
   * Selecting a person from the palette opens an existing DM with them or
   * creates a new one. Mirrors the DM dialog's create logic.
   */
  async function openOrCreateDm(userId: string) {
    if (!client?.user?.id) return;
    try {
      const channel = client.channel("messaging", undefined, {
        members: [client.user.id, userId],
        property_id: propertyId,
      } as Record<string, unknown>);
      await channel.create();
      setOpen(false);
      if (channel.id) openChannel("messaging", channel.id);
    } catch (e) {
      console.error("openOrCreateDm failed", e);
    }
  }
}

/**
 * Icon for a Recent row, derived from the entry type. Action recents reuse
 * the action's own icon (looked up by id, since we only persist minimal
 * data); anything unresolvable falls back to the History glyph.
 */
function recentIcon(entry: RecentEntry, actions: PaletteAction[]) {
  switch (entry.type) {
    case "action":
      return actions.find((a) => a.id === entry.id)?.icon ?? History;
    case "channel":
      return Hash;
    case "dm":
    case "person":
      return UserIcon;
    case "task":
      return ListChecks;
    case "message":
      return MessageSquareText;
    default:
      return History;
  }
}

function dmTitle(channel: Channel, currentUserId: string | undefined) {
  const others = Object.values(channel.state.members ?? {})
    .map((m) => m.user)
    .filter((u): u is NonNullable<typeof u> => !!u && u.id !== currentUserId);
  if (others.length === 0) return "(empty conversation)";
  if (others.length === 1) return others[0].name ?? others[0].id;
  return others.map((u) => u.name ?? u.id).join(", ");
}

function DmIcon({
  channel,
  currentUserId,
}: {
  channel: Channel;
  currentUserId: string | undefined;
}) {
  const other = Object.values(channel.state.members ?? {})
    .map((m) => m.user)
    .find((u) => u && u.id !== currentUserId);
  if (!other) {
    return <UserIcon className="size-4 text-faint-foreground" />;
  }
  return (
    <Avatar className="size-5">
      <AvatarImage src={other.image as string | undefined} />
      <AvatarFallback className="text-xs">
        {initialsOf(other.name ?? other.id)}
      </AvatarFallback>
    </Avatar>
  );
}

function initialsOf(s: string): string {
  return (
    s
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
