"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search } from "lucide-react";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Everyone who belongs to the current property, with avatar + role. */
export function MembersDialog({ propertyId, open, onOpenChange }: Props) {
  const { data: members = [], isLoading } = useQuery({
    ...propertyMembersQueryOptions(propertyId),
    enabled: open,
  });
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? members.filter((m) => (m.name ?? "").toLowerCase().includes(term))
      : members;
    // Owners first, then managers, then staff; alphabetical within a role.
    const rank: Record<string, number> = { owner: 0, manager: 1, staff: 2 };
    return [...list].sort(
      (a, b) =>
        (rank[a.role] ?? 3) - (rank[b.role] ?? 3) ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );
  }, [members, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>People</DialogTitle>
          <DialogDescription>
            {members.length} {members.length === 1 ? "person" : "people"} in this
            property.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className="h-9 pl-8 text-sm"
          />
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {q.trim() ? "No one matches that search." : "No members yet."}
          </p>
        ) : (
          <ul
            role="list"
            className="-mx-1 max-h-80 overflow-y-auto"
          >
            {filtered.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-md px-1 py-2"
              >
                <Avatar className="size-8">
                  {m.avatarUrl ? (
                    <AvatarImage src={m.avatarUrl} alt="" />
                  ) : null}
                  <AvatarFallback className="text-[0.625rem]">
                    {initials(m.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm tracking-tight text-foreground">
                  {m.name ?? "Unnamed"}
                </span>
                <span className="shrink-0 text-xs tracking-tight text-muted-foreground capitalize">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
