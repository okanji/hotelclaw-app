"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Target } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type { EntityColor, InitiativeStatus } from "@/lib/db/types";
import { LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";
import { createInitiative } from "./actions";
import { INITIATIVE_STATUS_META, INITIATIVE_STATUSES } from "./initiative-status";

/**
 * New-initiative modal: name, one-line summary, status, target date, colour
 * and optional emoji. The creator becomes the owner (changeable on the page).
 * On create it opens the initiative.
 */
export function CreateInitiativeDialog({
  open,
  onOpenChange,
  propertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<InitiativeStatus>("planned");
  const [targetDate, setTargetDate] = useState("");
  const [color, setColor] = useState<EntityColor>("violet");
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setDescription("");
    setStatus("planned");
    setTargetDate("");
    setColor("violet");
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
    const res = await createInitiative({
      propertyId,
      name: trimmed,
      description: description.trim() || null,
      status,
      targetDate: targetDate || null,
      color,
      icon: icon.trim() || null,
    });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["initiatives", propertyId] });
    reset();
    onOpenChange(false);
    router.push(`/p/${propertyId}/initiatives/${res.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <Target className="size-4 text-muted-foreground" />
            New initiative
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            An initiative is a property-wide goal — &ldquo;Refresh all guest rooms
            by Q2&rdquo; — that several projects work toward.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-base">
            {icon.trim() || <span className={cn("size-3 rounded-full", LABEL_DOT[color])} />}
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
            placeholder="e.g. Refresh all guest rooms"
            aria-label="Initiative name"
            disabled={busy}
            className="h-9"
          />
        </div>

        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does done look like? (optional)"
          aria-label="Description"
          disabled={busy}
          className="text-sm"
        />

        <div className="flex flex-col gap-2">
          <span className="text-xs/[1] font-medium text-faint-foreground">Status</span>
          <div className="flex items-center gap-1">
            {INITIATIVE_STATUSES.map((s) => (
              <Chip key={s} size="sm" selected={status === s} onClick={() => setStatus(s)}>
                <span
                  className={cn("size-2 rounded-full", INITIATIVE_STATUS_META[s].dot)}
                  aria-hidden="true"
                />
                {INITIATIVE_STATUS_META[s].label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs/[1] font-medium text-faint-foreground">Target date</span>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              disabled={busy}
              className="h-9 w-[10rem] text-sm"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs/[1] font-medium text-faint-foreground">Icon (optional)</span>
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 2))}
              placeholder="🛏️"
              disabled={busy}
              className="h-9 w-20"
            />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs/[1] font-medium text-faint-foreground">Color</span>
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
            Create initiative
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
