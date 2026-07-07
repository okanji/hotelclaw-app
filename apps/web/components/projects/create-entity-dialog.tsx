"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderKanban, Loader2, Users } from "lucide-react";
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
import { createProject, createSpace } from "./actions";
import { LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";

const COLORS = LABEL_COLORS;
const SWATCH = LABEL_DOT;

const COPY = {
  space: {
    title: "New space",
    description:
      "A space is a department or area — F&B, Maintenance, Events. Tasks, docs, members, and channels live in a space.",
    placeholder: "e.g. Food & Beverage",
    defaultColor: "slate" as EntityColor,
    icon: Users,
  },
  project: {
    title: "New project",
    description:
      "A project is a cross-space initiative — a Wedding or a Festival — that pulls work from several spaces.",
    placeholder: "e.g. Summer Wedding",
    defaultColor: "blue" as EntityColor,
    icon: FolderKanban,
  },
};

/**
 * Create-a-Space / Create-a-Project modal: name + color (+ optional emoji icon).
 * On submit it creates the entity and opens its workspace. Shared by the Home
 * sidebar `+` actions and the index pages.
 */
export function CreateEntityDialog({
  open,
  onOpenChange,
  propertyId,
  kind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  kind: "space" | "project";
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const copy = COPY[kind];
  const [name, setName] = useState("");
  const [color, setColor] = useState<EntityColor>(copy.defaultColor);
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setColor(copy.defaultColor);
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
    const opts = { color, icon: icon.trim() || null };
    const res =
      kind === "space"
        ? await createSpace(propertyId, trimmed, opts)
        : await createProject(propertyId, trimmed, opts);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    const key = kind === "space" ? "spaces" : "projects";
    await qc.invalidateQueries({ queryKey: [key, propertyId] });
    reset();
    onOpenChange(false);
    router.push(`/p/${propertyId}/${key}/${res.id}`);
  }

  const Icon = copy.icon;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium tracking-tight">
            <Icon className="size-4 text-muted-foreground" />
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-sm tracking-tight text-muted-foreground">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 text-base">
            {icon.trim() || <Icon className="size-4 text-muted-foreground" />}
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
            placeholder={copy.placeholder}
            disabled={busy}
            className="h-9"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Color
          </span>
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110",
                  color === c &&
                    "ring-2 ring-foreground/40 ring-offset-2 ring-offset-background",
                )}
              >
                <span className={cn("size-4 rounded-full", SWATCH[c])} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Icon (optional)
          </span>
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value.slice(0, 2))}
            placeholder="Paste an emoji — 🍽️ 🔧 💍"
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
            Create {kind}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
