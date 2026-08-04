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
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Hash,
  ListChecks,
  Lock,
  MessageSquareText,
  Search,
  User as UserIcon,
} from "lucide-react";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { cn } from "@/lib/utils";

/**
 * Palette chrome, per docs/notion-spec.md §4/§5.
 *
 * The overlay recipe: 10px radius + the one three-layer elevation whose LAST
 * layer is the 1px warm ring — so the panel carries no `border` and no
 * `ring-*` utility (stacking either double-rings it).
 */
const PALETTE_PANEL = "rounded-overlay p-0 ring-0 shadow-overlay";

/**
 * The input row is 44px, chrome-free, and divided from the results by a single
 * 1px warm ring — not by a boxed form control. `CommandInput` renders an
 * `InputGroup` we can't reach through props, so it is retuned by data-slot
 * from the `<Command>` wrapper.
 */
const PALETTE_INPUT_ROW = [
  "[&_[data-slot=command-input-wrapper]]:border-b",
  "[&_[data-slot=command-input-wrapper]]:border-border",
  "[&_[data-slot=command-input-wrapper]]:p-0",
  "[&_[data-slot=input-group]]:h-11!",
  "[&_[data-slot=input-group]]:rounded-none!",
  "[&_[data-slot=input-group]]:border-0!",
  "[&_[data-slot=input-group]]:bg-transparent!",
  "[&_[data-slot=input-group]]:ring-0!",
  "[&_[data-slot=input-group]]:px-1!",
].join(" ");

/** Group heading: 12px/12px weight 500 faint, sentence case, no tracking. */
const PALETTE_GROUP =
  "**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:leading-3 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-faint-foreground";

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
      description="Search channels, people, tasks, and messages"
      className={PALETTE_PANEL}
    >
      {/* This shadcn build of CommandDialog doesn't wrap children in
          <Command> itself, so cmdk's internal context isn't provided to
          its subcomponents. Wrap explicitly. `shouldFilter={false}` because
          we already do all the filtering server-side per group. */}
      <Command
        shouldFilter={false}
        className={cn("rounded-overlay p-0", PALETTE_INPUT_ROW)}
      >
        <CommandInput
          placeholder="Search channels, people, tasks, messages…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="p-1">
          <CommandEmpty className="py-6 text-center text-sm text-faint-foreground">
            {hasQuery ? "No results." : "Start typing to search."}
          </CommandEmpty>

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
                  onSelect={() => goChannel(c.type, c.id ?? "")}
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
                onSelect={() => goChannel(c.type, c.id ?? "")}
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
                onSelect={() => openOrCreateDm(m.id)}
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
                onSelect={() => go(`/p/${propertyId}/tasks/${t.id}`)}
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
                    goChannel(message.cid?.split(":")[0], channelId, {
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
      </Command>
    </CommandDialog>
  );

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
