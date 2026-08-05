"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PropertyRow } from "@/components/projects/workspace-shell";
import type { EntityColor } from "@/lib/db/types";
import {
  labelsQueryOptions,
  projectLabelsQueryOptions,
  spaceLabelsQueryOptions,
  type LabelRow,
} from "@/lib/query/label-queries";
import {
  addProjectLabel,
  addSpaceLabel,
  createAndAddProjectLabel,
  createAndAddSpaceLabel,
  removeProjectLabel,
  removeSpaceLabel,
  setLabelColor,
} from "@/components/labels/actions";
import { LABEL_CHIP, LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";
import { ManageLabelsFooter } from "@/components/labels/labels-manager";

type EntityKind = "project" | "space";

const QUERY_KEY: Record<EntityKind, (propertyId: string, entityId: string) => readonly unknown[]> = {
  project: (propertyId, entityId) => ["project-labels", propertyId, entityId],
  space: (propertyId, entityId) => ["space-labels", propertyId, entityId],
};

/**
 * Linear-style Labels row for a project or space. Uses the property-wide label
 * catalog — the same labels that tag tasks and documents.
 */
export function EntityLabelsRow({
  propertyId,
  entityKind,
  entityId,
}: {
  propertyId: string;
  entityKind: EntityKind;
  entityId: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: projectApplied = [] } = useQuery({
    ...projectLabelsQueryOptions(propertyId, entityId),
    enabled: entityKind === "project",
  });
  const { data: spaceApplied = [] } = useQuery({
    ...spaceLabelsQueryOptions(propertyId, entityId),
    enabled: entityKind === "space",
  });
  const applied = entityKind === "project" ? projectApplied : spaceApplied;
  const { data: catalog = [] } = useQuery(labelsQueryOptions(propertyId));

  const appliedIds = useMemo(() => new Set(applied.map((l) => l.id)), [applied]);
  const q = query.trim().toLowerCase();
  const filtered = catalog.filter((l) =>
    q ? l.name.toLowerCase().includes(q) : true,
  );
  const exact = catalog.some((l) => l.name.toLowerCase() === q);

  function refresh() {
    void qc.invalidateQueries({
      queryKey: QUERY_KEY[entityKind](propertyId, entityId),
    });
    void qc.invalidateQueries({ queryKey: ["labels", propertyId] });
  }

  async function toggle(label: LabelRow) {
    const res = appliedIds.has(label.id)
      ? entityKind === "project"
        ? await removeProjectLabel(entityId, label.id)
        : await removeSpaceLabel(entityId, label.id)
      : entityKind === "project"
        ? await addProjectLabel(entityId, label.id)
        : await addSpaceLabel(entityId, label.id);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

  async function create() {
    const name = query.trim();
    if (!name) return;
    const res =
      entityKind === "project"
        ? await createAndAddProjectLabel(propertyId, entityId, name)
        : await createAndAddSpaceLabel(propertyId, entityId, name);
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

  return (
    <PropertyRow label="Labels">
      <div className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
        {applied.map((l) => (
          <span
            key={l.id}
            className={cn(
              // A label is a Notion SELECT PILL, not a clickable: 20px tall,
              // 4px radius, `0 6px` padding, 14px w500 (notion-spec-v2 §6).
              // The fill/ink pair comes from LABEL_CHIP, so no `bg-muted`
              // base is needed underneath it.
              "group flex h-5 max-w-[200px] items-center gap-1 rounded-pill px-1.5 text-sm font-medium",
              LABEL_CHIP[l.color],
            )}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", LABEL_DOT[l.color])} />
            <span className="min-w-0 truncate">{l.name}</span>
            <button
              type="button"
              aria-label={`Remove ${l.name}`}
              onClick={() => void toggle(l)}
              className="-mr-0.5 ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-md text-current/60 opacity-0 transition-opacity hover:bg-accent hover:text-current group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery("");
          }}
        >
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="Add label"
                className="text-muted-foreground"
              />
            }
          >
            <Plus className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-72 p-0">
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
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <span className={cn("size-2 shrink-0 rounded-full", LABEL_DOT[l.color])} />
                      <span className="min-w-0 flex-1 truncate">
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
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover/label:opacity-100"
                          />
                        }
                      >
                        <span className={cn("size-3 rounded-full", LABEL_DOT[l.color])} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={4}>
                        {LABEL_COLORS.map((c) => (
                          <DropdownMenuItem
                            key={c}
                            onClick={() => void recolor(l.id, c)}
                            className="gap-2 capitalize"
                          >
                            <span className={cn("size-3 rounded-full", LABEL_DOT[c])} />
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
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        Create &ldquo;{query.trim()}&rdquo;
                      </span>
                    </button>
                  </li>
                ) : null}
                {filtered.length === 0 && !query.trim() ? (
                  <li className="px-2 py-3 text-center text-xs text-faint-foreground">
                    No labels yet — type to create one.
                  </li>
                ) : null}
              </ul>
            </div>
            <ManageLabelsFooter propertyId={propertyId} />
          </PopoverContent>
        </Popover>
      </div>
    </PropertyRow>
  );
}
