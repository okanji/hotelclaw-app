"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
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
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const router = useRouter();
  const { client } = useChatContext();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Member[]>([]);
  const [pending, startTransition] = useTransition();

  const { data: members = [] } = useQuery<Member[]>({
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const me = client?.user?.id;
    return members.filter((m) => {
      if (m.id === me) return false;
      if (picked.find((p) => p.id === m.id)) return false;
      if (!q) return true;
      return (m.name ?? "").toLowerCase().includes(q) || m.id.includes(q);
    });
  }, [members, query, picked, client?.user?.id]);

  function pick(m: Member) {
    setPicked((p) => [...p, m]);
    setQuery("");
  }
  function unpick(id: string) {
    setPicked((p) => p.filter((x) => x.id !== id));
  }

  function start() {
    if (!client?.user?.id || picked.length === 0) return;
    startTransition(async () => {
      try {
        const memberIds = [client.user!.id, ...picked.map((p) => p.id)];
        // distinct=true causes Stream to dedupe channels by member set, so the
        // same DM partners always land in the same channel — Slack-like behavior.
        const channel = client.channel("messaging", undefined, {
          members: memberIds,
          property_id: propertyId,
        } as Record<string, unknown>);
        await channel.create();
        onOpenChange(false);
        setPicked([]);
        setQuery("");
        if (channel.id) router.push(`/p/${propertyId}/chat/${channel.id}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to start DM");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
          <DialogDescription>
            Pick one or more people from this property.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {picked.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {picked.map((p) => (
                <button
                  key={p.id}
                  onClick={() => unpick(p.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                >
                  {p.name ?? p.id}
                  <X className="size-3" />
                </button>
              ))}
            </div>
          ) : null}
          <Input
            autoFocus
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={pending}
          />
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                {query ? "No matches." : "Nobody else in this property yet."}
              </div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => pick(m)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                  )}
                >
                  <Avatar className="size-6">
                    <AvatarImage src={m.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      {(m.name ?? "?")
                        .split(/\s+/)
                        .map((p) => p[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join("")
                        .toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1">{m.name ?? m.id}</span>
                  <span className="text-xs text-muted-foreground">{m.role}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
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
            {pending ? "Starting…" : `Start chat${picked.length > 1 ? ` (${picked.length})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
