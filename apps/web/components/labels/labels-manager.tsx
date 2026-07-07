"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Plus, Settings2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { labelsQueryOptions, type LabelRow } from "@/lib/query/label-queries";
import type { EntityColor } from "@/lib/db/types";
import { LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";
import {
  createLabel,
  deleteLabel,
  renameLabel,
  setLabelColor,
} from "./actions";

const COLORS = LABEL_COLORS;
const DOT = LABEL_DOT;

/**
 * Property-wide label management — create, rename, recolor, delete. The
 * same catalog backs tasks, documents, projects, and spaces, so this lives
 * in a dialog reachable from every label picker (via `ManageLabelsFooter`)
 * rather than on a standalone page: labels are workspace configuration you
 * touch while labeling something, not a destination.
 */
export function ManageLabelsDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: labels = [], isPending } = useQuery({
    ...labelsQueryOptions(propertyId),
    enabled: open,
  });
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["labels", propertyId] });
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const res = await createLabel(propertyId, name);
    setCreating(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setNewName("");
    refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage labels</DialogTitle>
          <DialogDescription>
            One shared set for tasks, documents, projects, and spaces —
            rename or recolor a label and it updates everywhere.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder="New label name…"
            aria-label="New label name"
            className="h-8"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleCreate()}
            disabled={creating || !newName.trim()}
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create
          </Button>
        </div>

        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading labels…</p>
        ) : labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No labels yet. Create one above, or add a label to a task or
            document.
          </p>
        ) : (
          <ul
            role="list"
            className="-mx-1 max-h-80 overflow-y-auto border-t border-border/40"
          >
            {labels.map((l) => (
              <LabelManagerRow key={l.id} label={l} onChanged={refresh} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Manage labels…" footer for label-picker popovers — the standard way into
 * the manager dialog. Render after the picker's list; self-contained.
 */
export function ManageLabelsFooter({ propertyId }: { propertyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="border-t border-border/60 p-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings2 className="size-3.5 shrink-0" />
          Manage labels…
        </button>
      </div>
      <ManageLabelsDialog
        propertyId={propertyId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function LabelManagerRow({
  label,
  onChanged,
}: {
  label: LabelRow;
  onChanged: () => void;
}) {
  const [name, setName] = useState(label.name);

  async function commitName() {
    const next = name.trim();
    if (!next || next === label.name) {
      setName(label.name);
      return;
    }
    const res = await renameLabel(label.id, next);
    if ("error" in res) {
      toast.error(res.error);
      setName(label.name);
    } else onChanged();
  }

  async function recolor(color: EntityColor) {
    const res = await setLabelColor(label.id, color);
    if ("error" in res) toast.error(res.error);
    else onChanged();
  }

  async function remove() {
    if (!window.confirm(`Delete label "${label.name}"? It will be removed from everything it tags.`))
      return;
    const res = await deleteLabel(label.id);
    if ("error" in res) toast.error(res.error);
    else onChanged();
  }

  return (
    <li className="group/label flex items-center gap-3 border-b border-border/40 px-1 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button type="button" aria-label="Color" className="shrink-0" />
          }
        >
          <span className={cn("block size-3 rounded-full", DOT[label.color])} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6}>
          {COLORS.map((c) => (
            <DropdownMenuItem
              key={c}
              onClick={() => void recolor(c)}
              className="gap-2 capitalize"
            >
              <span className={cn("size-3 rounded-full", DOT[c])} />
              <span className="flex-1">{c}</span>
              {label.color === c ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void commitName()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setName(label.name);
            e.currentTarget.blur();
          }
        }}
        aria-label="Label name"
        className="min-w-0 flex-1 bg-transparent text-sm tracking-tight text-foreground outline-none"
      />
      <button
        type="button"
        aria-label="Delete label"
        title="Delete"
        onClick={() => void remove()}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/label:opacity-100 hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
