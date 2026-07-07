"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import type { Channel as StreamChannel } from "stream-chat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarRange,
  Check,
  Hash,
  Link as LinkIcon,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  User as UserIcon,
  X,
} from "lucide-react";
import type {
  HasFilter,
  SearchState,
} from "./parse-search-params";

type Props = {
  propertyId: string;
  state: SearchState;
  onChange: (patch: Partial<SearchState>) => void;
};

type Member = {
  id: string;
  role: string;
  name: string | null;
  avatarUrl: string | null;
};

export function SearchFilterChips({ propertyId, state, onChange }: Props) {
  const hasAnyFilter =
    !!state.in || !!state.from || !!state.before || !!state.after || !!state.has;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {state.in ? (
        <ChannelChip
          propertyId={propertyId}
          channelId={state.in}
          onRemove={() => onChange({ in: null })}
        />
      ) : null}
      {state.from ? (
        <FromChip
          propertyId={propertyId}
          userId={state.from}
          onRemove={() => onChange({ from: null })}
        />
      ) : null}
      {state.after ? (
        <DateChip
          label={`after: ${formatDate(state.after)}`}
          onRemove={() => onChange({ after: null })}
        />
      ) : null}
      {state.before ? (
        <DateChip
          label={`before: ${formatDate(state.before)}`}
          onRemove={() => onChange({ before: null })}
        />
      ) : null}
      {state.has ? (
        <HasChip
          kind={state.has}
          onRemove={() => onChange({ has: null })}
        />
      ) : null}

      <AddFilterPopover
        propertyId={propertyId}
        state={state}
        onChange={onChange}
      />

      {hasAnyFilter ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() =>
            onChange({
              in: null,
              from: null,
              before: null,
              after: null,
              has: null,
            })
          }
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function ChipShell({
  icon,
  children,
  onRemove,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <Badge
      variant="secondary"
      className="h-7 gap-1 rounded-full px-2 text-xs font-normal"
    >
      {icon}
      <span className="max-w-[200px] truncate">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted-foreground/15 hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}

function ChannelChip({
  propertyId,
  channelId,
  onRemove,
}: {
  propertyId: string;
  channelId: string;
  onRemove: () => void;
}) {
  const { client } = useChatContext();
  const me = client?.user?.id;
  const { data } = useQuery({
    queryKey: ["search-channel-name", propertyId, channelId, me],
    enabled: !!client && !!me,
    staleTime: 60_000,
    queryFn: async (): Promise<{ name: string; isDm: boolean; isPrivate: boolean } | null> => {
      if (!client || !me) return null;
      const channels = await client.queryChannels(
        {
          property_id: propertyId,
          id: channelId,
          members: { $in: [me] },
        } as Parameters<typeof client.queryChannels>[0],
        undefined,
        { limit: 1 },
      );
      const c = channels[0];
      if (!c) return null;
      const d = c.data as { name?: string; is_private?: boolean } | undefined;
      const isDm = c.type === "messaging";
      const name = isDm ? dmTitle(c, me) : (d?.name ?? c.id ?? "channel");
      return { name, isDm, isPrivate: !!d?.is_private };
    },
  });

  const Icon = !data
    ? Hash
    : data.isDm
      ? MessageSquare
      : data.isPrivate
        ? Lock
        : Hash;

  return (
    <ChipShell icon={<Icon className="size-3" />} onRemove={onRemove}>
      in: {data?.name ?? channelId}
    </ChipShell>
  );
}

function FromChip({
  propertyId,
  userId,
  onRemove,
}: {
  propertyId: string;
  userId: string;
  onRemove: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["search-property-members", propertyId],
    staleTime: 60_000,
    queryFn: async (): Promise<Member[]> => {
      const r = await fetch(`/api/properties/${propertyId}/members`, {
        cache: "no-store",
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const name = data?.find((m) => m.id === userId)?.name ?? userId;
  return (
    <ChipShell icon={<UserIcon className="size-3" />} onRemove={onRemove}>
      from: {name}
    </ChipShell>
  );
}

function DateChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <ChipShell icon={<CalendarRange className="size-3" />} onRemove={onRemove}>
      {label}
    </ChipShell>
  );
}

function HasChip({ kind, onRemove }: { kind: HasFilter; onRemove: () => void }) {
  const Icon = kind === "links" ? LinkIcon : Paperclip;
  return (
    <ChipShell icon={<Icon className="size-3" />} onRemove={onRemove}>
      has: {kind}
    </ChipShell>
  );
}

function AddFilterPopover({
  propertyId,
  state,
  onChange,
}: {
  propertyId: string;
  state: SearchState;
  onChange: (patch: Partial<SearchState>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"root" | "from" | "after" | "before" | "in">(
    "root",
  );
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setMode("root");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 rounded-full border-dashed px-2 text-xs"
          />
        }
      >
        <Plus className="size-3" />
        Add filter
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        {mode === "root" ? (
          <ul className="py-1 text-sm">
            <FilterMenuItem
              icon={<Hash className="size-4" />}
              label="Channel or DM"
              onClick={() => setMode("in")}
            />
            <FilterMenuItem
              icon={<UserIcon className="size-4" />}
              label="From person"
              onClick={() => setMode("from")}
            />
            <FilterMenuItem
              icon={<CalendarRange className="size-4" />}
              label="After date"
              onClick={() => setMode("after")}
            />
            <FilterMenuItem
              icon={<CalendarRange className="size-4" />}
              label="Before date"
              onClick={() => setMode("before")}
            />
            <FilterMenuItem
              icon={<Paperclip className="size-4" />}
              label="Has files"
              onClick={() => {
                onChange({ has: "files" });
                setOpen(false);
              }}
              checked={state.has === "files"}
            />
            <FilterMenuItem
              icon={<LinkIcon className="size-4" />}
              label="Has links"
              onClick={() => {
                onChange({ has: "links" });
                setOpen(false);
              }}
              checked={state.has === "links"}
            />
          </ul>
        ) : mode === "from" ? (
          <FromPicker
            propertyId={propertyId}
            onPick={(id) => {
              onChange({ from: id });
              setOpen(false);
            }}
          />
        ) : mode === "in" ? (
          <InPicker
            onPick={(id) => {
              onChange({ in: id });
              setOpen(false);
            }}
          />
        ) : (
          <DatePicker
            onPick={(iso) => {
              onChange(mode === "after" ? { after: iso } : { before: iso });
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterMenuItem({
  icon,
  label,
  onClick,
  checked,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  checked?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
      >
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1">{label}</span>
        {checked ? <Check className="size-4 text-muted-foreground" /> : null}
      </button>
    </li>
  );
}

function DatePicker({ onPick }: { onPick: (iso: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="p-3">
      <Input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        size="sm"
        className="mt-2 w-full"
        disabled={!value}
        onClick={() => {
          if (value) onPick(new Date(`${value}T00:00:00Z`).toISOString());
        }}
      >
        Apply
      </Button>
    </div>
  );
}

function FromPicker({
  propertyId,
  onPick,
}: {
  propertyId: string;
  onPick: (userId: string) => void;
}) {
  const [q, setQ] = useState("");
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["search-property-members", propertyId],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/members`, {
        cache: "no-store",
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return members.slice(0, 8);
    return members
      .filter((m) => (m.name ?? "").toLowerCase().includes(t) || m.id.toLowerCase().includes(t))
      .slice(0, 8);
  }, [members, q]);

  return (
    <div className="flex flex-col p-2">
      <Input
        autoFocus
        placeholder="Find a person…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-8"
      />
      <ul className="mt-2 max-h-64 overflow-auto">
        {filtered.length === 0 ? (
          <li className="px-2 py-2 text-xs text-muted-foreground">No matches.</li>
        ) : (
          filtered.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(m.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <UserIcon className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{m.name ?? m.id}</span>
                <span className="text-xs text-muted-foreground capitalize">
                  {m.role}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function InPicker({ onPick }: { onPick: (channelId: string) => void }) {
  const { client } = useChatContext();
  const me = client?.user?.id;
  const [q, setQ] = useState("");
  const { data: channels = [] } = useQuery<StreamChannel[]>({
    queryKey: ["search-in-picker", me, q],
    enabled: !!client && !!me,
    queryFn: async () => {
      if (!client || !me) return [];
      const filter = {
        type: { $in: ["team", "messaging"] },
        members: { $in: [me] },
        ...(q.trim() ? { name: { $autocomplete: q.trim() } } : {}),
      };
      return client.queryChannels(
        filter as Parameters<typeof client.queryChannels>[0],
        { last_message_at: -1 },
        { limit: 12 },
      );
    },
  });

  return (
    <div className="flex flex-col p-2">
      <Input
        autoFocus
        placeholder="Find a channel or DM…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-8"
      />
      <ul className="mt-2 max-h-64 overflow-auto">
        {channels.length === 0 ? (
          <li className="px-2 py-2 text-xs text-muted-foreground">No matches.</li>
        ) : (
          channels.map((c) => {
            const d = c.data as { name?: string; is_private?: boolean } | undefined;
            const isDm = c.type === "messaging";
            const label = isDm ? dmTitle(c, me) : (d?.name ?? c.id ?? "channel");
            const Icon = isDm ? MessageSquare : d?.is_private ? Lock : Hash;
            return (
              <li key={c.cid}>
                <button
                  type="button"
                  onClick={() => c.id && onPick(c.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function dmTitle(channel: StreamChannel, currentUserId: string | undefined) {
  const others = Object.values(channel.state.members ?? {})
    .map((m) => m.user)
    .filter((u): u is NonNullable<typeof u> => !!u && u.id !== currentUserId);
  if (others.length === 0) return "(empty conversation)";
  if (others.length === 1) return others[0].name ?? others[0].id;
  return others.map((u) => u.name ?? u.id).join(", ");
}
