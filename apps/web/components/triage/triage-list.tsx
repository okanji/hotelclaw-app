"use client";

import { ConciergeBell, Sparkles, UserRound, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { triageAge, type TriageIntake } from "@/lib/tasks/triage-logic";
import type { TriageQueueItem } from "@/lib/query/triage-queries";

const INTAKE_ICON = {
  guest: ConciergeBell,
  ai: Sparkles,
  workflow: Workflow,
  person: UserRound,
} as const;

export function IntakeIcon({
  intake,
  className,
}: {
  intake: TriageIntake;
  className?: string;
}) {
  const Icon = INTAKE_ICON[intake.kind];
  return (
    <Icon
      aria-label={intake.kind === "guest" ? "Guest chatbot" : intake.kind}
      className={cn("size-3.5 shrink-0 text-faint-foreground", className)}
    />
  );
}

/**
 * The left pane — one row per pending item: title, then a quiet meta line
 * (team · where it came from) with the age right-aligned, Linear's inbox
 * row. The selected row sits on the pressed rung; hover is fill only.
 */
export function TriageList({
  items,
  selectedId,
  spaceNames,
  onSelect,
}: {
  items: TriageQueueItem[];
  selectedId: string | null;
  spaceNames: Map<string, string>;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-px py-2 pr-2 pl-[calc(var(--page-gutter)-0.625rem)]" role="listbox" aria-label="Triage queue">
      {items.map((item) => {
        const selected = item.id === selectedId;
        const team = item.space_id ? spaceNames.get(item.space_id) : null;
        return (
          <li key={item.id} role="option" aria-selected={selected}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left outline-none focus-visible:shadow-focus",
                selected ? "bg-accent-pressed" : "hover:bg-accent",
              )}
            >
              <span className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium",
                    selected ? "text-foreground" : "text-secondary-ink",
                  )}
                >
                  {item.title}
                </span>
                <span className="shrink-0 text-xs text-faint-foreground tabular-nums">
                  {triageAge(item.created_at)}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <IntakeIcon intake={item.intake} />
                <span className="truncate">{item.intake.label}</span>
                {team ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 truncate">{team}</span>
                  </>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
