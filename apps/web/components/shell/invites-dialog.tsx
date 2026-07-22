"use client";

import { useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  MailX,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { revokeInvite, updateInviteRole } from "@/lib/invites/actions";
import type { Role } from "@/lib/db/types";

/** Roles a pending invite can be switched to, most-privileged first. */
const ROLE_ORDER: Role[] = ["owner", "manager", "staff"];

type InviteRow = {
  token: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "expired";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  invitedByName: string | null;
};

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the "Invite people" composer — wired up by the parent. */
  onInviteNew?: () => void;
};

/**
 * Management view for invites SENT for this property: Pending (still
 * outstanding) and Past (accepted or expired). Owner/manager only.
 */
export function InvitesDialog({
  propertyId,
  open,
  onOpenChange,
  onInviteNew,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["property-invites", propertyId],
    enabled: open,
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/invites`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("Failed to load invites");
      return (await r.json()) as { pending: InviteRow[]; past: InviteRow[] };
    },
  });

  const pending = data?.pending ?? [];
  const past = data?.past ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invites</DialogTitle>
          <DialogDescription>
            People you&rsquo;ve invited to this property.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="pending">
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="pending">
                Pending
                {pending.length > 0 ? (
                  <Badge
                    variant="secondary"
                    className="ml-1.5 h-4 min-w-4 px-1 tabular-nums"
                  >
                    {pending.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="past">Past</TabsTrigger>
            </TabsList>
            {onInviteNew ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onInviteNew();
                }}
              >
                <UserPlus />
                Invite
              </Button>
            ) : null}
          </div>

          <TabsContent value="pending" className="mt-3">
            <InviteList
              propertyId={propertyId}
              rows={pending}
              isLoading={isLoading}
              empty={{
                icon: <Send className="size-5" />,
                title: "No pending invites",
                hint: "Invites you send will show up here until they're accepted.",
              }}
            />
          </TabsContent>

          <TabsContent value="past" className="mt-3">
            <InviteList
              propertyId={propertyId}
              rows={past}
              isLoading={isLoading}
              empty={{
                icon: <Clock className="size-5" />,
                title: "Nothing here yet",
                hint: "Accepted and expired invites land here.",
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function InviteList({
  propertyId,
  rows,
  isLoading,
  empty,
}: {
  propertyId: string;
  rows: InviteRow[];
  isLoading: boolean;
  empty: { icon: React.ReactNode; title: string; hint: string };
}) {
  if (isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {empty.icon}
        </div>
        <p className="text-sm font-medium text-foreground">{empty.title}</p>
        <p className="max-w-[16rem] text-xs text-muted-foreground text-pretty">
          {empty.hint}
        </p>
      </div>
    );
  }
  return (
    <ul role="list" className="-mx-1 max-h-80 divide-y divide-border overflow-y-auto">
      {rows.map((row) => (
        <InviteRowItem key={row.token} propertyId={propertyId} row={row} />
      ))}
    </ul>
  );
}

function InviteRowItem({
  propertyId,
  row,
}: {
  propertyId: string;
  row: InviteRow;
}) {
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();

  function copyLink() {
    const url = `${window.location.origin}/invites/${row.token}`;
    navigator.clipboard.writeText(url).then(() => {
      toast.success("Invite link copied");
    });
  }

  function changeRole(next: Role) {
    if (next === row.role) return;
    startTransition(async () => {
      const result = await updateInviteRole({
        propertyId,
        token: row.token,
        role: next,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`They'll join as ${next}.`);
      qc.invalidateQueries({ queryKey: ["property-invites", propertyId] });
      qc.invalidateQueries({ queryKey: ["pending-invites"] });
    });
  }

  function revoke() {
    startTransition(async () => {
      const result = await revokeInvite({ propertyId, token: row.token });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Invite revoked");
      qc.invalidateQueries({ queryKey: ["property-invites", propertyId] });
      qc.invalidateQueries({ queryKey: ["pending-invites"] });
    });
  }

  return (
    <li className="flex items-center gap-3 px-1 py-2.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase",
          row.status === "accepted"
            ? "bg-success/10 text-success"
            : row.status === "expired"
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary",
        )}
      >
        {row.email.slice(0, 1)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {row.email}
          </span>
          {row.status === "pending" ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Change role for ${row.email}`}
                    disabled={pending}
                    className="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  />
                }
              >
                <Badge variant="secondary" className="capitalize">
                  {row.role}
                  <ChevronDown className="ml-0.5 size-3 opacity-60" />
                </Badge>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ROLE_ORDER.map((id) => (
                  <DropdownMenuItem
                    key={id}
                    onClick={() => changeRole(id)}
                    className="gap-2 capitalize"
                  >
                    <Check
                      className={cn(
                        "size-4",
                        row.role === id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {id}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Badge variant="secondary" className="shrink-0 capitalize">
              {row.role}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {metaLine(row)}
        </p>
      </div>

      {row.status === "pending" ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={copyLink}
            aria-label="Copy invite link"
          >
            <Copy />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={revoke}
            disabled={pending}
            aria-label="Revoke invite"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      ) : (
        <StatusBadge status={row.status} />
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: "accepted" | "expired" }) {
  if (status === "accepted") {
    return (
      <Badge className="shrink-0 gap-1 bg-success/10 text-success">
        <CheckCircle2 />
        Accepted
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
      <MailX />
      Expired
    </Badge>
  );
}

function metaLine(row: InviteRow): string {
  if (row.status === "accepted") {
    return row.acceptedAt
      ? `Accepted ${formatDate(row.acceptedAt)}`
      : "Accepted";
  }
  if (row.status === "expired") {
    return `Expired ${formatDate(row.expiresAt)}`;
  }
  const by = row.invitedByName ? ` · by ${row.invitedByName}` : "";
  return `${expiresLabel(row.expiresAt)}${by}`;
}

function expiresLabel(expiresAt: string): string {
  const days = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
