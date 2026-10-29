"use client";

import { isDone } from "@/lib/tasks/statuses";
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useConnectedStreamClient } from "@/lib/stream/client-provider";
import type { Channel, MessageResponse } from "stream-chat";
import { useCommandPalette } from "./command-palette-context";
import {
  Command,
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  ArrowRight,
  FileText,
  Hash,
  History,
  ListChecks,
  Lock,
  MessageSquareText,
  Search,
  Table2,
  User as UserIcon,
} from "lucide-react";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { cn } from "@/lib/utils";
import { relativeTimeShort } from "@/lib/relative-time";
import { COLUMNS } from "@/components/tasks/kanban";
import { taskKey } from "@/lib/tasks/task-key";
import type { DocumentSearchHit } from "@/lib/documents/search";
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
  "**:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:leading-3 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground";

/**
 * Result row: 32px tall, 6px radius, 14px label, warm fill on selection. The
 * only ink the row flips on selection is the trailing `↵` affordance (hidden
 * at rest) — labels never change colour (notion-spec-v2 §6).
 */
const PALETTE_ITEM =
  "group/row ai-fade-up h-8 rounded-md px-2 py-0 text-sm data-selected:bg-accent";

/** Right-aligned meta on a result row — 12px weight 400 faint, tabular. */
const PALETTE_META =
  "ml-auto flex shrink-0 items-center gap-2 text-xs font-normal text-faint-foreground tabular-nums";

/** Glyph slot: every row leads with a 20px box so labels align across kinds. */
const PALETTE_GLYPH =
  "flex size-5 shrink-0 items-center justify-center text-faint-foreground";

type Member = {
  id: string;
  role: string;
  name: string | null;
  avatarUrl: string | null;
};

type Task = {
  id: string;
  key?: string | null;
  title: string;
  status: string;
  priority: string;
  project_name?: string | null;
};

type DocRow = {
  id: string;
  title: string | null;
  kind: string | null;
  icon: string | null;
  updated_at: string;
};

/**
 * Prefix grammar (Slack / Linear): a leading `>` scopes the palette to
 * commands, `#` to channels, `@` to people + DMs. The prefix stays in the
 * input (so Backspace clears it naturally) and the matched scope is echoed
 * as a chip in the input row.
 */
type Scope = "all" | "commands" | "channels" | "people";

const SCOPE_PREFIX: Record<string, Scope> = {
  ">": "commands",
  "#": "channels",
  "@": "people",
};

const SCOPE_LABEL: Record<Exclude<Scope, "all">, string> = {
  commands: "Commands",
  channels: "Channels",
  people: "People",
};

function parseQuery(raw: string): { scope: Scope; term: string } {
  const scope = SCOPE_PREFIX[raw[0] ?? ""];
  if (scope) return { scope, term: raw.slice(1).trim() };
  return { scope: "all", term: raw.trim() };
}

const STATUS_TONE = Object.fromEntries(
  COLUMNS.map((c) => [c.id, { tone: c.pillTone, label: c.label }]),
) as Record<string, { tone: (typeof COLUMNS)[number]["pillTone"]; label: string }>;

/**
 * Cmd+K / Ctrl+K command palette. Searches across:
 *   - Channels (Stream queryChannels, type=team)
 *   - Direct messages (Stream queryChannels, type=messaging)
 *   - People (this property's members)
 *   - Tasks (this property's tasks)
 *   - Documents (recent while empty; keyword RPC once there's a query)
 *   - Messages (Stream search)
 *
 * Plus the non-search groups (`command-palette-actions.ts`):
 *   - Recent — the last 5 selections, per property in localStorage,
 *     shown only while the query is empty.
 *   - Quick actions — the `create` actions, shown while the query is empty
 *     or matches.
 *   - Go to — the `navigate` actions; only once the query matches them or
 *     the `>` prefix is typed, so the resting palette leads with the
 *     channels / people / tasks it is mostly opened for.
 *
 * Runs cmdk with `shouldFilter={false}` — every group filters itself.
 *
 * Mounted once at the property layout — the global keyboard listener owns
 * the open state, so any keyboard event in the app can open it.
 */
export function CommandPalette({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const openChannel = useOpenChannel(propertyId);
  const client = useConnectedStreamClient();
  // Single source of truth for open state — the provider owns it so the
  // keyboard shortcut and the sidebar Search button drive the same dialog.
  const { open, setOpen } = useCommandPalette();
  const [query, setQuery] = useState("");

  // Every close path runs through here so reopening starts fresh — a reset
  // in an effect on `open` would be a setState-in-effect cascade.
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, [setOpen]);

  const me = client?.user?.id;
  const { scope, term } = useMemo(() => parseQuery(query), [query]);
  const hasQuery = term.length > 0;
  const showCommands = scope === "all" || scope === "commands";
  const showChannels = scope === "all" || scope === "channels";
  const showPeople = scope === "all" || scope === "people";
  // Tasks / docs / messages have no prefix of their own — they only show in
  // the unscoped palette.
  const showData = scope === "all";

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
  const quickActions = useMemo(
    () =>
      showCommands
        ? actions.filter((a) => a.group === "create" && matchesAction(a, term))
        : [],
    [actions, term, showCommands],
  );
  const navActions = useMemo(
    () =>
      scope === "commands" || (scope === "all" && hasQuery)
        ? actions.filter((a) => a.group === "navigate" && matchesAction(a, term))
        : [],
    [actions, term, scope, hasQuery],
  );

  const go = useCallback(
    (path: string) => {
      close();
      router.push(path);
    },
    [router, close],
  );

  // Channel/DM selections route through `openChannel` — a client-side
  // pushState when already in chat, so the palette switch is instant.
  function goChannel(
    channelType: string | undefined,
    channelId: string,
    opts?: { messageId?: string },
  ) {
    close();
    openChannel(channelType, channelId, opts);
  }

  // ---- Channels (team) ------------------------------------------------------
  const { data: teamChannels = [], isFetching: fetchingChannels } = useQuery<
    Channel[]
  >({
    queryKey: ["cmdk", "team", propertyId, me, term],
    enabled: open && !!client && !!me && showChannels,
    queryFn: async () => {
      if (!client || !me) return [];
      const filter = {
        type: "team",
        property_id: propertyId,
        members: { $in: [me] },
        ...(hasQuery ? { name: { $autocomplete: term } } : {}),
      };
      return client.queryChannels(
        filter as Parameters<typeof client.queryChannels>[0],
        { last_message_at: -1 },
        { limit: hasQuery ? 6 : 4 },
      );
    },
  });

  // ---- DMs (messaging) ------------------------------------------------------
  const { data: dmChannels = [], isFetching: fetchingDms } = useQuery<
    Channel[]
  >({
    queryKey: ["cmdk", "dm", propertyId, me, term],
    enabled: open && !!client && !!me && showPeople,
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
      if (!hasQuery) return channels.slice(0, 4);
      const q = term.toLowerCase();
      return channels
        .filter((c) => dmTitle(c, me).toLowerCase().includes(q))
        .slice(0, 5);
    },
  });

  // ---- People (property members) -------------------------------------------
  const { data: members = [], isFetching: fetchingPeople } = useQuery<Member[]>({
    queryKey: ["cmdk", "people", propertyId],
    enabled: open && showPeople,
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
    if (!showPeople) return [];
    const others = members.filter((m) => m.id !== me);
    if (!hasQuery) return others.slice(0, 4);
    const q = term.toLowerCase();
    return others
      .filter(
        (m) =>
          (m.name ?? "").toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [members, me, hasQuery, term, showPeople]);

  // ---- Tasks ---------------------------------------------------------------
  const { data: allTasks = [], isFetching: fetchingTasks } = useQuery<Task[]>({
    queryKey: ["cmdk", "tasks", propertyId],
    enabled: open && showData,
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
    if (!showData) return [];
    if (!hasQuery) return allTasks.filter((t) => !isDone(t)).slice(0, 4);
    const q = term.toLowerCase();
    return allTasks
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.key ?? "").toLowerCase() === q,
      )
      .slice(0, 5);
  }, [allTasks, hasQuery, term, showData]);

  // ---- Documents -----------------------------------------------------------
  // Resting: the 4 most recently edited docs (the list endpoint is already
  // updated_at-ordered). Searching: the keyword RPC, which also matches body
  // text and returns a preview — titles alone miss most of what people
  // remember a document by.
  const { data: recentDocs = [] } = useQuery<DocRow[]>({
    queryKey: ["cmdk", "docs-recent", propertyId],
    enabled: open && showData && !hasQuery,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/documents`, {
        cache: "no-store",
      });
      if (!r.ok) return [];
      const rows = (await r.json()) as DocRow[];
      return rows.slice(0, 4);
    },
  });

  const { data: docHits = [], isFetching: fetchingDocs } = useQuery<
    DocumentSearchHit[]
  >({
    queryKey: ["cmdk", "docs-search", propertyId, term],
    enabled: open && showData && term.length >= 2,
    queryFn: async () => {
      const r = await fetch(
        `/api/properties/${propertyId}/documents/search?q=${encodeURIComponent(term)}&limit=5`,
        { cache: "no-store" },
      );
      if (!r.ok) return [];
      const body = (await r.json()) as { results?: DocumentSearchHit[] };
      return body.results ?? [];
    },
  });

  // ---- Messages (Stream search) --------------------------------------------
  const { data: messageHits = [], isFetching: fetchingMessages } = useQuery<
    MessageResponse[]
  >({
    queryKey: ["cmdk", "messages", propertyId, me, term],
    enabled: open && !!client && !!me && showData && term.length >= 2,
    queryFn: async () => {
      if (!client || !me) return [];
      const res = await client.search(
        {
          type: { $in: ["team", "messaging"] },
          property_id: propertyId,
          members: { $in: [me] },
        } as Parameters<typeof client.search>[0],
        term,
        { limit: 5, sort: [{ created_at: -1 }] },
      );
      return (res.results ?? []).map((r) => r.message as MessageResponse);
    },
  });

  const docs: Array<{
    id: string;
    title: string;
    kind: string | null;
    icon: string | null;
    preview: string | null;
    updatedAt: string;
  }> = hasQuery
    ? docHits.map((d) => ({
        id: d.id,
        title: d.title,
        kind: null,
        icon: null,
        preview: d.preview,
        updatedAt: d.updated_at,
      }))
    : recentDocs.map((d) => ({
        id: d.id,
        title: d.title ?? "Untitled",
        kind: d.kind,
        icon: d.icon,
        preview: null,
        updatedAt: d.updated_at,
      }));

  const searching =
    hasQuery &&
    (fetchingChannels ||
      fetchingDms ||
      fetchingPeople ||
      fetchingTasks ||
      fetchingDocs ||
      fetchingMessages);

  const resultCount =
    quickActions.length +
    navActions.length +
    teamChannels.length +
    dmChannels.length +
    filteredPeople.length +
    filteredTasks.length +
    docs.length +
    messageHits.length;

  const placeholder =
    scope === "commands"
      ? "Type a command…"
      : scope === "channels"
        ? "Search channels…"
        : scope === "people"
          ? "Search people…"
          : "Search channels, people, tasks, docs, messages…";

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title="Search"
      description="Search channels, people, tasks, documents and messages, or jump to a section"
      className={PALETTE_PANEL}
    >
      {/* This shadcn build of CommandDialog doesn't wrap children in
          <Command> itself, so cmdk's internal context isn't provided to
          its subcomponents. Wrap explicitly. `shouldFilter={false}` because
          every group filters itself (server-side or by scope). */}
      <Command
        shouldFilter={false}
        // cmdk re-selects the first row whenever the list changes; with
        // `loop` the arrow keys wrap, which matters in a list this long.
        loop
        className="rounded-modal p-0"
      >
        <div className="relative">
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
            className={cn(scope !== "all" && "pl-20")}
          />
          {scope !== "all" ? (
            // Scope chip echoes the prefix: it sits over the input's own
            // padding, after the search glyph, and the input's text is
            // pushed right by `pl-24` so the two never overlap.
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-9 inline-flex h-5 -translate-y-1/2 items-center rounded-pill bg-pill-info px-1.5 text-xs font-medium text-pill-info-ink"
            >
              {SCOPE_LABEL[scope]}
            </span>
          ) : null}
        </div>

        {/* 700px panel − 44px input − 41px footer ≈ 615px of results. */}
        <CommandList className="max-h-[min(615px,60vh)] p-1">
          {/* cmdk's own Empty never fires in the unscoped palette because the
              "Search all messages" fallback row is always present, so the
              status line is rendered explicitly whenever nothing else is. */}
          {resultCount === 0 ? (
            <div className="py-10 text-center">
              {searching ? (
                <span className="text-sm text-faint-foreground">Searching…</span>
              ) : hasQuery ? (
                <>
                  <div className="text-sm text-foreground">
                    No results for{" "}
                    <span className="font-medium">&ldquo;{term}&rdquo;</span>
                  </div>
                  <div className="mt-1 text-xs text-faint-foreground">
                    {scope === "all"
                      ? "Try fewer or different words, or search all messages below."
                      : `Nothing in ${SCOPE_LABEL[scope].toLowerCase()} — clear the prefix to search everything.`}
                  </div>
                </>
              ) : (
                <span className="text-sm text-faint-foreground">
                  Start typing to search.
                </span>
              )}
            </div>
          ) : null}

          {!hasQuery && scope === "all" && recents.length > 0 ? (
            <CommandGroup heading="Recent" className={PALETTE_GROUP}>
              {recents.map((entry, i) => {
                const Icon = recentIcon(entry, actions);
                return (
                  <CommandItem
                    key={`recent-${entry.type}-${entry.id ?? entry.href ?? entry.label}`}
                    value={`recent-${entry.type}-${entry.id ?? entry.href ?? entry.label}`}
                    onSelect={() => openRecent(entry)}
                    className={PALETTE_ITEM}
                    style={enterDelay(i)}
                  >
                    <span className={PALETTE_GLYPH}>
                      <Icon className="size-4" />
                    </span>
                    <span className="truncate">{entry.label}</span>
                    <span className={PALETTE_META}>
                      <span>{recentKindLabel(entry.type)}</span>
                      <EnterHint />
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {/* No per-row shortcut hints here: none of these actions has a real
              global shortcut (the shell registers only Cmd+K and Cmd+\), and
              the footer already carries the palette's own hints. */}
          {quickActions.length > 0 ? (
            <CommandGroup
              heading={hasQuery ? "Actions" : "Quick actions"}
              className={PALETTE_GROUP}
            >
              {quickActions.map((action, i) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  index={i}
                  onSelect={() => selectAction(action)}
                />
              ))}
            </CommandGroup>
          ) : null}

          {navActions.length > 0 ? (
            <CommandGroup heading="Go to" className={PALETTE_GROUP}>
              {navActions.map((action, i) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  index={i}
                  onSelect={() => selectAction(action)}
                />
              ))}
            </CommandGroup>
          ) : null}

          {teamChannels.length > 0 ? (
            <CommandGroup heading="Channels" className={PALETTE_GROUP}>
              {teamChannels.map((c, i) => {
                const data = c.data as
                  | { name?: string; is_private?: boolean; member_count?: number }
                  | undefined;
                const Icon = data?.is_private ? Lock : Hash;
                const name = data?.name ?? c.id ?? "";
                const count = data?.member_count;
                return (
                  <CommandItem
                    key={c.cid}
                    value={`channel-${c.cid}-${name}`}
                    onSelect={() => {
                      remember({
                        type: "channel",
                        id: `${c.type}:${c.id ?? ""}`,
                        label: name,
                      });
                      goChannel(c.type, c.id ?? "");
                    }}
                    className={PALETTE_ITEM}
                    style={enterDelay(i)}
                  >
                    <span className={PALETTE_GLYPH}>
                      <Icon className="size-4" />
                    </span>
                    <span className="truncate">
                      <Highlight text={name} term={term} />
                    </span>
                    <span className={PALETTE_META}>
                      {data?.is_private ? <span>Private</span> : null}
                      {typeof count === "number" ? (
                        <span>
                          {count} {count === 1 ? "member" : "members"}
                        </span>
                      ) : null}
                      <EnterHint />
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {dmChannels.length > 0 ? (
            <CommandGroup heading="Direct messages" className={PALETTE_GROUP}>
              {dmChannels.map((c, i) => {
                const title = dmTitle(c, me);
                const last = c.state.last_message_at;
                return (
                  <CommandItem
                    key={c.cid}
                    value={`dm-${c.cid}-${title}`}
                    onSelect={() => {
                      remember({
                        type: "dm",
                        id: `${c.type}:${c.id ?? ""}`,
                        label: title,
                      });
                      goChannel(c.type, c.id ?? "");
                    }}
                    className={PALETTE_ITEM}
                    style={enterDelay(i)}
                  >
                    <span className={PALETTE_GLYPH}>
                      <DmIcon channel={c} currentUserId={me} />
                    </span>
                    <span className="truncate">
                      <Highlight text={title} term={term} />
                    </span>
                    <span className={PALETTE_META}>
                      {last ? <span>{relativeTimeShort(last)}</span> : null}
                      <EnterHint />
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {filteredPeople.length > 0 ? (
            <CommandGroup heading="People" className={PALETTE_GROUP}>
              {filteredPeople.map((m, i) => (
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
                  style={enterDelay(i)}
                >
                  <span className={PALETTE_GLYPH}>
                    <Avatar className="size-5">
                      <AvatarImage src={m.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-xs">
                        {initialsOf(m.name ?? m.id)}
                      </AvatarFallback>
                    </Avatar>
                  </span>
                  <span className="truncate">
                    <Highlight text={m.name ?? m.id} term={term} />
                  </span>
                  <span className={PALETTE_META}>
                    <span className="capitalize">{m.role}</span>
                    <EnterHint label="Message" />
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {filteredTasks.length > 0 ? (
            <CommandGroup heading="Tasks" className={PALETTE_GROUP}>
              {filteredTasks.map((t, i) => {
                const status = STATUS_TONE[t.status];
                return (
                  <CommandItem
                    key={t.id}
                    value={`task-${t.id}-${t.title}`}
                    onSelect={() => {
                      const href = `/p/${propertyId}/tasks/${t.id}`;
                      remember({ type: "task", id: t.id, label: t.title, href });
                      go(href);
                    }}
                    className={PALETTE_ITEM}
                    style={enterDelay(i)}
                  >
                    <span className={PALETTE_GLYPH}>
                      <ListChecks className="size-4" />
                    </span>
                    <span className="shrink-0 font-mono text-xs text-faint-foreground tabular-nums">
                      {taskKey(t)}
                    </span>
                    <span className="truncate">
                      <Highlight text={t.title} term={term} />
                    </span>
                    <span className={PALETTE_META}>
                      {t.project_name ? (
                        <span className="hidden max-w-40 truncate sm:inline">
                          {t.project_name}
                        </span>
                      ) : null}
                      {status ? (
                        <StatusBadge tone={status.tone} className="text-xs">
                          {status.label}
                        </StatusBadge>
                      ) : null}
                      <EnterHint />
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {docs.length > 0 ? (
            <CommandGroup heading="Documents" className={PALETTE_GROUP}>
              {docs.map((d, i) => {
                const Icon = d.kind === "sheet" ? Table2 : FileText;
                return (
                  <CommandItem
                    key={d.id}
                    value={`doc-${d.id}-${d.title}`}
                    onSelect={() => {
                      const href = `/p/${propertyId}/documents/${d.id}`;
                      remember({
                        type: "document",
                        id: d.id,
                        label: d.title || "Untitled",
                        href,
                      });
                      go(href);
                    }}
                    className={PALETTE_ITEM}
                    style={enterDelay(i)}
                  >
                    <span className={PALETTE_GLYPH}>
                      {d.icon ? (
                        <span className="text-sm leading-none">{d.icon}</span>
                      ) : (
                        <Icon className="size-4" />
                      )}
                    </span>
                    <span className="shrink-0 truncate">
                      <Highlight text={d.title || "Untitled"} term={term} />
                    </span>
                    {d.preview ? (
                      <span className="min-w-0 truncate text-xs text-faint-foreground">
                        <Highlight text={d.preview} term={term} />
                      </span>
                    ) : null}
                    <span className={PALETTE_META}>
                      <span>{relativeTimeShort(d.updatedAt)}</span>
                      <EnterHint />
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {messageHits.length > 0 ? (
            <CommandGroup heading="Messages" className={PALETTE_GROUP}>
              {messageHits.map((message, i) => {
                const channelType = message.cid?.split(":")[0];
                const channelId = message.cid?.split(":")[1];
                const channelName =
                  channelType === "team"
                    ? `#${(message.channel as { name?: string } | undefined)?.name ?? channelId ?? ""}`
                    : "Direct message";
                const sender =
                  message.user?.name ?? message.user?.id ?? "Someone";
                return (
                  <CommandItem
                    key={message.id}
                    value={`msg-${message.id}-${message.text}`}
                    onSelect={() => {
                      if (!channelId) return;
                      remember({
                        type: "message",
                        id: `${channelType ?? ""}:${channelId}:${message.id}`,
                        label: message.text || "(attachment)",
                      });
                      goChannel(channelType, channelId, {
                        messageId: message.id,
                      });
                    }}
                    // Two-line result — the only row that outgrows the pitch.
                    className={cn(PALETTE_ITEM, "h-auto items-start py-1.5")}
                    style={enterDelay(i)}
                  >
                    <span className={cn(PALETTE_GLYPH, "mt-px")}>
                      <Avatar className="size-5">
                        <AvatarImage
                          src={message.user?.image as string | undefined}
                        />
                        <AvatarFallback className="text-xs">
                          {initialsOf(sender)}
                        </AvatarFallback>
                      </Avatar>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5 text-xs">
                        <span className="truncate font-medium text-foreground">
                          {sender}
                        </span>
                        <span className="truncate text-faint-foreground">
                          {channelName}
                        </span>
                        <span className="ml-auto shrink-0 text-faint-foreground tabular-nums">
                          {relativeTimeShort(message.created_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                        <Highlight
                          text={message.text || "(attachment)"}
                          term={term}
                        />
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {hasQuery && scope === "all" ? (
            <CommandGroup className={cn(PALETTE_GROUP, "mt-1 border-t border-border pt-1")}>
              <CommandItem
                value={`see-all-results-${term}`}
                onSelect={() =>
                  go(`/p/${propertyId}/search?q=${encodeURIComponent(term)}`)
                }
                className={PALETTE_ITEM}
              >
                <span className={PALETTE_GLYPH}>
                  <Search className="size-4" />
                </span>
                <span className="truncate text-muted-foreground">
                  Search all messages for{" "}
                  <span className="font-medium text-foreground">
                    &ldquo;{term}&rdquo;
                  </span>
                </span>
                <span className={PALETTE_META}>
                  <ArrowRight className="size-3.5" />
                </span>
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>

        {/* The measured footer bar (notion-spec-v2 §6): 41px, under a single
            warm hairline, carrying 12px faint shortcut hints. Left = how to
            move; right = the scope grammar, which is otherwise invisible. */}
        <CommandFooter className="mx-0 mt-0 mb-0">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            close
          </span>
          <span className="ml-auto hidden items-center gap-3 sm:flex">
            {resultCount > 0 && hasQuery ? (
              <span className="tabular-nums">
                {resultCount} {resultCount === 1 ? "result" : "results"}
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <Kbd>&gt;</Kbd>
              commands
            </span>
            <span className="flex items-center gap-1">
              <Kbd>#</Kbd>
              channels
            </span>
            <span className="flex items-center gap-1">
              <Kbd>@</Kbd>
              people
            </span>
          </span>
        </CommandFooter>
      </Command>
    </CommandDialog>
  );

  function selectAction(action: PaletteAction) {
    remember({
      type: "action",
      id: action.id,
      label: action.label,
      href: action.href,
    });
    go(action.href);
  }

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
      case "document":
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
      close();
      if (channel.id) openChannel("messaging", channel.id);
    } catch (e) {
      console.error("openOrCreateDm failed", e);
    }
  }
}

/**
 * Rows enter with the house fade-up, staggered 30ms and capped at the 6th
 * row — enough that a fresh result set reads as arriving, not enough that
 * typing feels laggy. `both` fill (from `.ai-fade-up`) keeps later rows
 * invisible until their beat; reduced-motion is handled by the class.
 */
function enterDelay(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index, 6) * 30}ms` };
}

function ActionRow({
  action,
  index,
  onSelect,
}: {
  action: PaletteAction;
  index: number;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`action-${action.id}`}
      onSelect={onSelect}
      className={PALETTE_ITEM}
      style={enterDelay(index)}
    >
      <span className={PALETTE_GLYPH}>
        <action.icon className="size-4" />
      </span>
      <span className="truncate">{action.label}</span>
      <span className={PALETTE_META}>
        <EnterHint label={action.group === "create" ? "Create" : "Jump"} />
      </span>
    </CommandItem>
  );
}

/**
 * Trailing "what Enter does" affordance, visible only on the selected row
 * (Linear / Raycast). Invisible at rest so the meta column stays quiet, but
 * it keeps a FIXED width on every row — otherwise the member counts, roles
 * and status pills to its left would sit at a different offset per row.
 * The `group/row` on `PALETTE_ITEM` is what the data-selected lookup keys on.
 */
function EnterHint({ label = "Open" }: { label?: string }) {
  return (
    <span className="hidden w-20 items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-data-[selected=true]/row:opacity-100 sm:inline-flex">
      <span>{label}</span>
      <Kbd className="h-4 min-w-4 bg-background/70">↵</Kbd>
    </span>
  );
}

/**
 * Emphasise the query inside a label. Plain text when there's no term or no
 * hit; otherwise the matched run is full ink + medium weight — no colour,
 * no background, so it survives the selected fill and the dark plane.
 */
function Highlight({ text, term }: { text: string; term: string }): ReactNode {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-medium text-foreground">
        {text.slice(idx, idx + term.length)}
      </span>
      {text.slice(idx + term.length)}
    </>
  );
}

function recentKindLabel(kind: RecentEntry["type"]): string {
  switch (kind) {
    case "action":
      return "Action";
    case "channel":
      return "Channel";
    case "dm":
      return "Direct message";
    case "person":
      return "Person";
    case "task":
      return "Task";
    case "document":
      return "Document";
    case "message":
      return "Message";
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
    case "document":
      return FileText;
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
    return <UserIcon className="size-4" />;
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
