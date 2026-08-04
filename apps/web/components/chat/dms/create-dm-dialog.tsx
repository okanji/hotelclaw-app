"use client";

import { useState, useTransition, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOpenChannel } from "@/lib/chat/use-open-channel";

type Member = {
  id: string;
  role: string;
  name: string | null;
  avatarUrl: string | null;
};

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateDmDialog({ propertyId, open, onOpenChange }: Props) {
  const openChannel = useOpenChannel(propertyId);
  const { client } = useChatContext();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Member[]>([]);
  const [pending, startTransition] = useTransition();

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ["property-members", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/members`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    enabled: open,
  });

  const me = client?.user?.id;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const eligible = members.filter((m) => m.id !== me);
    if (!q) return eligible;
    return eligible.filter(
      (m) =>
        (m.name ?? "").toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q),
    );
  }, [members, query, me]);

  function isPicked(id: string) {
    return picked.some((p) => p.id === id);
  }
  function toggle(m: Member) {
    if (isPicked(m.id)) setPicked((p) => p.filter((x) => x.id !== m.id));
    else setPicked((p) => [...p, m]);
  }

  function start() {
    if (!client?.user?.id || picked.length === 0) return;
    startTransition(async () => {
      try {
        const memberIds = [client.user!.id, ...picked.map((p) => p.id)];
        const channel = client.channel("messaging", undefined, {
          members: memberIds,
          property_id: propertyId,
        } as Record<string, unknown>);
        await channel.create();
        onOpenChange(false);
        setPicked([]);
        setQuery("");
        if (channel.id) openChannel("messaging", channel.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to start DM");
      }
    });
  }

  const startLabel =
    picked.length === 0
      ? "Start chat"
      : picked.length === 1
        ? `Message ${picked[0].name ?? picked[0].id}`
        : `Start group chat (${picked.length})`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Pick one for a 1:1 chat or several to start a group.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <SearchField
            value={query}
            onChange={setQuery}
            disabled={pending}
            autoFocus
            placeholder="Search by name"
          />
          <ul role="list" className="-mx-2 max-h-72 overflow-y-auto">
            {isLoading ? (
              <SkeletonRowsTall count={4} />
            ) : filtered.length === 0 ? (
              <li className="p-4 text-center text-sm text-muted-foreground">
                {query ? "No matches." : "Nobody else in this property yet."}
              </li>
            ) : (
              filtered.map((m) => {
                const checked = isPicked(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m)}
                      aria-pressed={checked}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition",
                        checked ? "bg-primary/5" : "hover:bg-accent",
                      )}
                    >
                      <UserAvatar member={m} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {m.name ?? m.id}
                        </div>
                        <div className="truncate text-xs text-muted-foreground capitalize">
                          {m.role}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                        aria-hidden="true"
                      >
                        {checked ? (
                          <Check className="size-3" strokeWidth={3} />
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
        <DialogFooter className="border-t pt-3">
          <div className="mr-auto text-xs text-muted-foreground tabular-nums">
            {picked.length === 0
              ? "No one selected"
              : `${picked.length} selected`}
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={start}
            disabled={pending || picked.length === 0}
          >
            {pending ? "Starting…" : startLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserAvatar({ member }: { member: Member }) {
  const initials =
    (member.name ?? "?")
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <Avatar className="size-9 outline-1 -outline-offset-1 outline-black/5">
      <AvatarImage src={member.avatarUrl ?? undefined} />
      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
    </Avatar>
  );
}

function SearchField({
  value,
  onChange,
  disabled,
  autoFocus,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        autoFocus={autoFocus}
        className="pl-8"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

function SkeletonRowsTall({ count = 4 }: { count?: number }) {
  return (
    <ul aria-busy="true" aria-live="polite" className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-md px-2 py-2"
          style={{ opacity: Math.max(0.35, 1 - i * 0.18) }}
        >
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="size-5 shrink-0 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
