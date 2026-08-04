"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ai-elements/panel";
import { SurfaceBadge } from "@/components/workflows/builder/surface-badge";
import { STEPS } from "@/lib/workflows/catalog";
import type { StepCatalogEntry } from "@/lib/workflows/catalog/types";
import type { StepType } from "@/lib/workflows/spec";

// Left-pinned Panel — searchable list of every step in the catalog, grouped
// by surface. Drag onto the canvas or click to add at the viewport center.

export function NodePalette({
  onAddStep,
  onDragStart,
}: {
  onAddStep: (type: StepType) => void;
  onDragStart: (type: StepType, e: React.DragEvent) => void;
}) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = STEPS.filter((s) => {
      if (!q) return true;
      return (
        s.label.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });
    const map = new Map<string, StepCatalogEntry[]>();
    for (const s of matches) {
      const k = s.surface;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [query]);

  return (
    <Panel position="top-left" className="m-3 w-64 p-0">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Add a step…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-full rounded-sm border-0 bg-secondary pl-7 pr-2 text-xs outline-none focus-visible:shadow-focus focus:ring-primary/40"
          />
        </div>
      </div>
      <ul className="max-h-[60vh] overflow-y-auto p-1">
        {grouped.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-muted-foreground">
            No steps match “{query}”
          </li>
        )}
        {grouped.map(([surface, items]) => (
          <li key={surface} className="mb-1">
            <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-faint-foreground">
              {surface}
            </div>
            <ul>
              {items.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onAddStep(s.id)}
                    draggable
                    onDragStart={(e) => onDragStart(s.id, e)}
                    className={cn(
                      "group flex w-full cursor-grab items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent",
                      "active:cursor-grabbing",
                    )}
                    title={s.description}
                  >
                    <SurfaceBadge surface={s.surface} />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    <Plus className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
