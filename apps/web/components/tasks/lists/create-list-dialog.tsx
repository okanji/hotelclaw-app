"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { List, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { EntityColor } from "@/lib/db/types";
import { LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";
import { createList } from "./actions";

/**
 * Create-a-List modal (0114) — name + colour (+ optional emoji), scoped to a
 * team or property-level. The new list inherits its scope's pipeline; on
 * submit the board opens scoped to it (`?list=`). Shared by the Lists tree in
 * the Tasks sidebar and the team rows.
 */
export function CreateListDialog({
  open,
  onOpenChange,
  propertyId,
  spaceId,
  spaceName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  /** null = a property-level list. */
  spaceId: string | null;
  spaceName?: string | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<EntityColor>("slate");
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setColor("slate");
    setIcon("");
  }

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const res = await createList({
      propertyId,
      spaceId,
      name: trimmed,
      color,
      icon: icon.trim() || null,
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["status-catalog", propertyId] });
    reset();
    onOpenChange(false);
    router.push(`/p/${propertyId}/tasks?list=${res.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <List className="size-4 text-muted-foreground" />
            New list{spaceName ? ` in ${spaceName}` : ""}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            A list groups a team&apos;s work and owns its own status pipeline —
            Maintenance requests, Purchase orders, Weddings. It starts with
            {spaceName ? " the team's" : " the property's"} statuses; you can
            customise them from the list&apos;s settings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-base">
            {icon.trim() || <List className="size-4 text-muted-foreground" />}
          </span>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder="e.g. Maintenance requests"
            disabled={busy}
            className="h-9"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs/[1] font-medium text-faint-foreground">
            Color
          </span>
          <div className="flex items-center gap-2">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent",
                  color === c && "bg-accent-pressed shadow-focus",
                )}
              >
                <span className={cn("size-4 rounded-full", LABEL_DOT[c])} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs/[1] font-medium text-faint-foreground">
            Icon (optional)
          </span>
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value.slice(0, 2))}
            placeholder="Paste an emoji — 🔧 🛒 💍"
            disabled={busy}
            className="h-9 max-w-[12rem]"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy || !name.trim()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Create list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
