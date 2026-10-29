"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { FileText, Hash, List as ListIcon, MessageSquare, SquareCheck, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ScopeGrant, ScopeKind } from "@/lib/db/types";
import {
  grantGuestScope,
  listGuestGrants,
  revokeGuestScope,
  setGuestScopeEdit,
  type GuestGrantRow,
} from "@/lib/guests/actions";
import { GuestScopePicker } from "./guest-scope-picker";

const KIND_ICON: Record<ScopeKind, typeof Hash> = {
  space: Hash,
  list: ListIcon,
  task: SquareCheck,
  document: FileText,
  channel: MessageSquare,
};
const KIND_LABEL: Record<ScopeKind, string> = {
  space: "Team",
  list: "List",
  task: "Task",
  document: "Document",
  channel: "Channel",
};

/**
 * What one guest can see (0118): their grants, each removable and
 * switchable between view-only and can-edit, plus "Share more". Owner /
 * manager only (the actions re-check).
 */
export function GuestAccessDialog({
  propertyId,
  guest,
  open,
  onOpenChange,
}: {
  propertyId: string;
  guest: { id: string; name: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [grants, setGrants] = useState<GuestGrantRow[] | null>(null);
  const [adding, setAdding] = useState<ScopeGrant[]>([]);
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    const res = await listGuestGrants({ propertyId, userId: guest.id });
    if ("error" in res) toast.error(res.error);
    else setGrants(res.grants);
  }, [propertyId, guest.id]);

  useEffect(() => {
    if (open) void Promise.resolve().then(load);
  }, [open, load]);

  const shareMore = () =>
    start(async () => {
      for (const g of adding) {
        const res = await grantGuestScope({ propertyId, userId: guest.id, grant: g });
        if ("error" in res) {
          toast.error(res.error);
          return;
        }
      }
      setAdding([]);
      toast.success("Shared");
      await load();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{guest.name ?? "Guest"}&rsquo;s access</DialogTitle>
          <DialogDescription>
            Guests see only what is shared with them. A team includes its lists,
            tasks, documents and channels.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-60 divide-y divide-border overflow-y-auto">
          {grants === null ? (
            <li className="py-2 text-sm text-muted-foreground">Loading…</li>
          ) : grants.length === 0 ? (
            <li className="py-2 text-sm text-muted-foreground">Nothing shared yet.</li>
          ) : (
            grants.map((g) => {
              const Icon = KIND_ICON[g.scope_kind];
              return (
                <li key={g.id} className="flex items-center gap-2 py-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {g.label}
                    <span className="ml-1.5 text-xs text-faint-foreground">{KIND_LABEL[g.scope_kind]}</span>
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Can edit
                    <Switch
                      checked={g.can_edit}
                      disabled={pending}
                      onCheckedChange={(c) =>
                        start(async () => {
                          const res = await setGuestScopeEdit({ propertyId, grantId: g.id, canEdit: c });
                          if ("error" in res) toast.error(res.error);
                          await load();
                        })
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-muted-foreground"
                    aria-label={`Stop sharing ${g.label}`}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await revokeGuestScope({ propertyId, grantId: g.id });
                        if ("error" in res) toast.error(res.error);
                        await load();
                      })
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              );
            })
          )}
        </ul>
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Share more</p>
          <GuestScopePicker
            propertyId={propertyId}
            value={adding}
            onChange={setAdding}
            disabled={pending}
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={pending || adding.length === 0} onClick={shareMore}>
              Share
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
