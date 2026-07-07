"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChannelStateContext, useChatContext } from "stream-chat-react";
import type { ChannelMemberResponse } from "stream-chat";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MoreHorizontal, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMyRole } from "./use-my-role";

type PropertyMember = {
  id: string;
  role: string;
  name: string | null;
  avatarUrl: string | null;
};

export function MembersTab({ propertyId }: { propertyId: string }) {
  const { channel } = useChannelStateContext();
  const { client } = useChatContext();
  const myRole = useMyRole(propertyId, client?.user?.id);
  const canManage = myRole === "owner" || myRole === "manager";
  const isTeamChannel = channel.type === "team";

  const [members, setMembers] = useState<ChannelMemberResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  async function loadMembers() {
    try {
      const res = await channel.queryMembers({});
      setMembers(res.members ?? []);
    } catch (e) {
      console.error("queryMembers failed", e);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    channel
      .queryMembers({})
      .then((res) => {
        if (!cancelled) setMembers(res.members ?? []);
      })
      .catch((e) => console.error("queryMembers failed", e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  // Force a re-render when presence changes so dots update.
  const [, force] = useState(0);
  useEffect(() => {
    const sub = channel.on("user.presence.changed", () =>
      force((n) => n + 1),
    );
    return () => sub.unsubscribe();
  }, [channel]);

  async function removeMember(userId: string) {
    if (!isTeamChannel) return; // never remove from a DM
    setBusyMemberId(userId);
    try {
      await channel.removeMembers([userId]);
      await loadMembers();
      toast.success("Member removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusyMemberId(null);
    }
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-2">
      {isTeamChannel && canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => setAddOpen(true)}
        >
          <UserPlus className="size-4" />
          Add member
        </Button>
      ) : null}

      {members.length === 0 ? (
        <p className="text-xs text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="space-y-1">
          {members.map((m) => {
            const user = m.user;
            if (!user) return null;
            const isMe = user.id === client?.user?.id;
            const online = client?.state.users[user.id]?.online ?? false;
            const name = user.name ?? user.id;
            const initials = name
              .split(/\s+/)
              .map((p) => p[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase();
            const showRemove =
              isTeamChannel && canManage && !isMe && busyMemberId !== user.id;

            return (
              <li
                key={user.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <div className="relative">
                  <Avatar className="size-7 outline-1 -outline-offset-1 outline-black/5">
                    <AvatarImage src={user.image as string | undefined} />
                    <AvatarFallback className="text-[10px]">
                      {initials || "?"}
                    </AvatarFallback>
                  </Avatar>
                  {online ? (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500"
                      title="Online"
                    />
                  ) : null}
                </div>
                <div className="flex-1 truncate text-sm">
                  {name}
                  {isMe ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (you)
                    </span>
                  ) : null}
                </div>
                {m.role && m.role !== "member" ? (
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {m.role}
                  </span>
                ) : null}
                {showRemove ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label={`Manage ${name}`}
                        />
                      }
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => removeMember(user.id)}
                        >
                          <UserMinus className="size-4" />
                          Remove from channel
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {addOpen ? (
        <AddMemberDialog
          propertyId={propertyId}
          channelMemberIds={members.map((m) => m.user?.id).filter(Boolean) as string[]}
          open={addOpen}
          onOpenChange={setAddOpen}
          onAdded={loadMembers}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Add member dialog                                                          */
/* -------------------------------------------------------------------------- */

function AddMemberDialog({
  propertyId,
  channelMemberIds,
  open,
  onOpenChange,
  onAdded,
}: {
  propertyId: string;
  channelMemberIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<void> | void;
}) {
  const { channel } = useChannelStateContext();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: propertyMembers = [], isLoading } = useQuery<PropertyMember[]>({
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

  const candidates = useMemo(() => {
    const inChannel = new Set(channelMemberIds);
    const q = query.trim().toLowerCase();
    return propertyMembers
      .filter((m) => !inChannel.has(m.id))
      .filter((m) => {
        if (!q) return true;
        return (
          (m.name ?? "").toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q)
        );
      });
  }, [propertyMembers, channelMemberIds, query, isLoading]);

  async function add(m: PropertyMember) {
    setBusy(true);
    try {
      await channel.addMembers([m.id]);
      await onAdded();
      toast.success(`Added ${m.name ?? m.id}`);
      // Keep dialog open so admin can add several in a row.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to channel</DialogTitle>
          <DialogDescription>
            Add property members to this channel. They'll see it immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            name="memberSearch"
            aria-label="Search members"
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={busy}
          />
          <ul role="list" className="-mx-2 max-h-72 overflow-y-auto">
            {isLoading ? (
              <li className="p-3 text-center text-xs text-muted-foreground">
                Loading…
              </li>
            ) : candidates.length === 0 ? (
              <li className="p-4 text-center text-sm text-muted-foreground">
                {query
                  ? "No matches."
                  : "Everyone in this property is already here."}
              </li>
            ) : (
              candidates.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => add(m)}
                    disabled={busy}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-muted",
                    )}
                  >
                    <Avatar className="size-8 outline-1 -outline-offset-1 outline-black/5">
                      <AvatarImage src={m.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-xs">
                        {initialsOf(m.name ?? m.id)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {m.name ?? m.id}
                      </div>
                      <div className="truncate text-xs text-muted-foreground capitalize">
                        {m.role}
                      </div>
                    </div>
                    <UserPlus className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
