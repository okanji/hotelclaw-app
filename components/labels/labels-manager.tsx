"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { labelsQueryOptions, type LabelRow } from "@/lib/query/label-queries";
import type { EntityColor } from "@/lib/db/types";
import {
  createLabel,
  deleteLabel,
  renameLabel,
  setLabelColor,
} from "./actions";

const COLORS: EntityColor[] = ["slate", "blue", "green", "amber", "rose", "violet"];
const DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

/** Property-wide label manager: create, rename, recolor, delete. The same
 *  catalog backs task + document labels. */
export function LabelsManager({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { data: labels = [], isPending } = useQuery(
    labelsQueryOptions(propertyId),
  );
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
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <header className="flex flex-col gap-5">
        <p className="text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Workspace
        </p>
        <h1 className="text-[2.5rem] leading-none font-semibold tracking-tight text-foreground">
          Labels
        </h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed tracking-tight text-pretty text-muted-foreground">
          One shared set of labels for tasks and documents. Rename or recolor a
          label and it updates everywhere it&apos;s used.
        </p>
      </header>

      <hr className="my-10 border-border" />

      <div className="mb-8 flex items-center gap-2">
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
          className="h-9 max-w-xs"
        />
        <Button
          type="button"
          size="sm"
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
          No labels yet. Create one above, or add a label to a task or document.
        </p>
      ) : (
        <ul
          role="list"
          className="flex flex-col divide-y divide-border/40 border-t border-border/40"
        >
          {labels.map((l) => (
            <LabelManagerRow
              key={l.id}
              label={l}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </div>
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
    <li className="group/label flex items-center gap-3 px-1 py-2.5">
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
        className="min-w-0 flex-1 bg-transparent text-[0.875rem] tracking-tight text-foreground outline-none"
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
