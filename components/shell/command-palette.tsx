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
  User as UserIcon,
} from "lucide-react";

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
    >
      {/* This shadcn build of CommandDialog doesn't wrap children in
          <Command> itself, so cmdk's internal context isn't provided to
          its subcomponents. Wrap explicitly. `shouldFilter={false}` because
          we already do all the filtering server-side per group. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search channels, people, tasks, messages…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {hasQuery ? "No results." : "Start typing to search."}
          </CommandEmpty>

        {teamChannels.length > 0 ? (
          <CommandGroup heading="Channels">
            {teamChannels.map((c) => {
              const data = c.data as
                | { name?: string; is_private?: boolean }
                | undefined;
              const Icon = data?.is_private ? Lock : Hash;
              return (
                <CommandItem
                  key={c.cid}
                  value={`channel-${c.cid}-${data?.name ?? c.id}`}
                  onSelect={() => go(`/p/${propertyId}/chat/${c.id}`)}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span>{data?.name ?? c.id}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {dmChannels.length > 0 ? (
          <CommandGroup heading="Direct messages">
            {dmChannels.map((c) => (
              <CommandItem
                key={c.cid}
                value={`dm-${c.cid}-${dmTitle(c, me)}`}
                onSelect={() => go(`/p/${propertyId}/chat/${c.id}`)}
              >
                <DmIcon channel={c} currentUserId={me} />
                <span>{dmTitle(c, me)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredPeople.length > 0 ? (
          <CommandGroup heading="People">
            {filteredPeople.map((m) => (
              <CommandItem
                key={m.id}
                value={`person-${m.id}-${m.name ?? m.id}`}
                onSelect={() => openOrCreateDm(m.id)}
              >
                <Avatar className="size-5 outline-1 -outline-offset-1 outline-black/5">
                  <AvatarImage src={m.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {initialsOf(m.name ?? m.id)}
                  </AvatarFallback>
                </Avatar>
                <span>{m.name ?? m.id}</span>
                <span className="ml-auto text-xs text-muted-foreground capitalize">
                  {m.role}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredTasks.length > 0 ? (
          <CommandGroup heading="Tasks">
            {filteredTasks.map((t) => (
              <CommandItem
                key={t.id}
                value={`task-${t.id}-${t.title}`}
                onSelect={() => go(`/p/${propertyId}/tasks/${t.id}`)}
              >
                <ListChecks className="size-4 text-muted-foreground" />
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-xs text-muted-foreground capitalize">
                  {t.status.replace("_", " ")}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {messageHits.length > 0 ? (
          <CommandGroup heading="Messages">
            {messageHits.map(({ message, channelId }) => (
              <CommandItem
                key={message.id}
                value={`msg-${message.id}-${message.text}`}
                onSelect={() =>
                  channelId && go(`/p/${propertyId}/chat/${channelId}`)
                }
              >
                <MessageSquareText className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {message.text || "(attachment)"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {message.user?.name ?? message.user?.id ?? "Someone"}
                  </div>
                </div>
              </CommandItem>
            ))}
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
      if (channel.id) router.push(`/p/${propertyId}/chat/${channel.id}`);
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
    return <UserIcon className="size-4 text-muted-foreground" />;
  }
  return (
    <Avatar className="size-5 outline-1 -outline-offset-1 outline-black/5">
      <AvatarImage src={other.image as string | undefined} />
      <AvatarFallback className="text-[10px]">
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
