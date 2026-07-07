"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  documentLabelsQueryOptions,
  labelsQueryOptions,
  type LabelRow,
} from "@/lib/query/label-queries";
import type { EntityColor } from "@/lib/db/types";
import {
  addDocumentLabel,
  createAndAddDocumentLabel,
  removeDocumentLabel,
  setLabelColor,
} from "@/components/labels/actions";
import { ManageLabelsFooter } from "@/components/labels/labels-manager";
import { LABEL_CHIP, LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";

const COLORS = LABEL_COLORS;
const DOT = LABEL_DOT;
const CHIP = LABEL_CHIP;

/**
 * Labels affordance for the document header. Reads/writes the shared label
 * catalog (the same labels tasks use), so tagging a doc "guest-complaint" reuses
 * the existing label. Apply / remove / create / recolor from one popover.
 */
export function DocumentLabels({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: applied = [] } = useQuery(
    documentLabelsQueryOptions(propertyId, documentId),
  );
  const { data: catalog = [] } = useQuery(labelsQueryOptions(propertyId));

  const appliedIds = useMemo(() => new Set(applied.map((l) => l.id)), [applied]);
  const q = query.trim().toLowerCase();
  const filtered = catalog.filter((l) =>
    q ? l.name.toLowerCase().includes(q) : true,
  );
  const exact = catalog.some((l) => l.name.toLowerCase() === q);

  function refresh() {
    void qc.invalidateQueries({
      queryKey: ["document-labels", propertyId, documentId],
    });
    void qc.invalidateQueries({ queryKey: ["labels", propertyId] });
  }

  async function toggle(label: LabelRow) {
    const res = appliedIds.has(label.id)
      ? await removeDocumentLabel(documentId, label.id)
      : await addDocumentLabel(documentId, label.id);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

  async function create() {
    const name = query.trim();
    if (!name) return;
    const res = await createAndAddDocumentLabel(propertyId, documentId, name);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setQuery("");
    refresh();
  }

  async function recolor(labelId: string, color: EntityColor) {
    const res = await setLabelColor(labelId, color);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

  const count = applied.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Labels"
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium tracking-tight transition-colors",
              count > 0
                ? "text-foreground hover:bg-muted"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          />
        }
      >
        <Tag className="size-3.5" />
        <span className="tabular-nums">{count > 0 ? count : "Label"}</span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-0">
        {count > 0 ? (
          <div className="flex flex-wrap gap-1.5 border-b border-border/60 p-2.5">
            {applied.map((l) => (
              <span
                key={l.id}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs tracking-tight",
                  CHIP[l.color],
                )}
              >
                {l.name}
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => void toggle(l)}
                  className="-mr-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim() && !exact) {
                e.preventDefault();
                void create();
              }
            }}
            placeholder="Search or create…"
            className="h-8 text-sm"
          />
          <ul className="mt-1.5 max-h-60 overflow-y-auto">
            {filtered.map((l) => (
              <li key={l.id} className="group/label flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void toggle(l)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  <span className={cn("size-2 shrink-0 rounded-full", DOT[l.color])} />
                  <span className="min-w-0 flex-1 truncate tracking-tight">
                    {l.name}
                  </span>
                  {appliedIds.has(l.id) ? (
                    <Check className="size-3.5 shrink-0" />
                  ) : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Color for ${l.name}`}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/label:opacity-100"
                      />
                    }
                  >
                    <span className={cn("size-3 rounded-full", DOT[l.color])} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4}>
                    {COLORS.map((c) => (
                      <DropdownMenuItem
                        key={c}
                        onClick={() => void recolor(l.id, c)}
                        className="gap-2 capitalize"
                      >
                        <span className={cn("size-3 rounded-full", DOT[c])} />
                        <span className="flex-1">{c}</span>
                        {l.color === c ? <Check className="size-3.5" /> : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
            {query.trim() && !exact ? (
              <li>
                <button
                  type="button"
                  onClick={() => void create()}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate tracking-tight">
                    Create &ldquo;{query.trim()}&rdquo;
                  </span>
                </button>
              </li>
            ) : null}
            {filtered.length === 0 && !query.trim() ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                No labels yet — type to create one.
              </li>
            ) : null}
          </ul>
        </div>
        <ManageLabelsFooter propertyId={propertyId} />
      </PopoverContent>
    </Popover>
  );
}
