"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Users, UserMinus } from "lucide-react";
import {
  propertyMembersQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";
import { removeMember } from "@/lib/members/actions";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Owner-only controls (remove people). */
  canManage: boolean;
  /** Signed-in user's email — hides the remove control on their own row. */
  currentEmail: string;
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
export function MembersDialog({
  propertyId,
  open,
  onOpenChange,
  canManage,
  currentEmail,
}: Props) {
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
              <MemberRow
                key={m.id}
                member={m}
                propertyId={propertyId}
                removable={
                  canManage &&
                  (m.email ?? "").toLowerCase() !== currentEmail.toLowerCase()
                }
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({
  member,
  propertyId,
  removable,
}: {
  member: PropertyMember;
  propertyId: string;
  removable: boolean;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const role = ROLE_META[member.role] ?? {
    label: member.role,
    tone: "neutral" as RoleTone,
  };

  function remove() {
    startTransition(async () => {
      const result = await removeMember({ propertyId, userId: member.id });
      if ("error" in result) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success(`${member.name ?? "Member"} removed`);
      qc.invalidateQueries({ queryKey: ["property-members", propertyId] });
    });
  }

  return (
    <li className="group flex items-center gap-3 py-2.5">
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
      {removable && confirming ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={remove}
          >
            {pending ? "Removing…" : "Remove"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <StatusBadge tone={role.tone} className="capitalize">
            {role.label}
          </StatusBadge>
          {removable ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove ${member.name ?? "member"}`}
              className="size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              <UserMinus className="size-4" />
            </Button>
          ) : null}
        </>
      )}
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
