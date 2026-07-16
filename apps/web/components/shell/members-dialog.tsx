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
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Users } from "lucide-react";
import {
  propertyMembersQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type RoleTone = React.ComponentProps<typeof StatusBadge>["tone"];

/** Role → display label + badge tone. Owner is distinguished (violet), manager
 *  reads as an elevated state (info), everyone else stays quiet (neutral). */
const ROLE_META: Record<string, { label: string; tone: RoleTone }> = {
  owner: { label: "Owner", tone: "violet" },
  manager: { label: "Manager", tone: "info" },
  staff: { label: "Staff", tone: "neutral" },
};

const RANK: Record<string, number> = { owner: 0, manager: 1, staff: 2 };

/** Everyone who belongs to the current property, with avatar, email, and role. */
export function MembersDialog({ propertyId, open, onOpenChange }: Props) {
  const { data: members = [], isLoading } = useQuery({
    ...propertyMembersQueryOptions(propertyId),
    enabled: open,
  });
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? members.filter(
          (m) =>
            (m.name ?? "").toLowerCase().includes(term) ||
            (m.email ?? "").toLowerCase().includes(term),
        )
      : members;
    // Owners first, then managers, then staff; alphabetical within a role.
    return [...list].sort(
      (a, b) =>
        (RANK[a.role] ?? 3) - (RANK[b.role] ?? 3) ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );
  }, [members, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>People</DialogTitle>
          <DialogDescription>
            <span className="tabular-nums">{members.length}</span>{" "}
            {members.length === 1 ? "person" : "people"} in this property.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="member-search"
            aria-label="Search people"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="h-9 pl-9"
          />
        </div>

        {isLoading ? (
          <MemberSkeletons />
        ) : filtered.length === 0 ? (
          <EmptyRow searching={Boolean(q.trim())} />
        ) : (
          <ul
            role="list"
            className="max-h-80 divide-y divide-border/50 overflow-y-auto"
          >
            {filtered.map((m) => (
              <MemberRow key={m.id} member={m} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ member }: { member: PropertyMember }) {
  const role = ROLE_META[member.role] ?? {
    label: member.role,
    tone: "neutral" as RoleTone,
  };
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Avatar className="size-9 shrink-0">
        {member.avatarUrl ? (
          <AvatarImage src={member.avatarUrl} alt="" />
        ) : null}
        <AvatarFallback className="text-xs">
          {initials(member.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium tracking-tight text-foreground">
          {member.name ?? "Unnamed"}
        </p>
        {member.email ? (
          <p className="truncate text-xs text-muted-foreground">
            {member.email}
          </p>
        ) : null}
      </div>
      <StatusBadge tone={role.tone} className="capitalize">
        {role.label}
      </StatusBadge>
    </li>
  );
}

function MemberSkeletons() {
  return (
    <ul role="list" className="divide-y divide-border/50">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

function EmptyRow({ searching }: { searching: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Users className="size-6 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground">
        {searching ? "No one matches that search." : "No members yet."}
      </p>
    </div>
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
