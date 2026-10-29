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
      className={cn("i shrink-0", className)}
      size={13}
      strokeWidth={1.8}
      style={{ color: "var(--g8-text-3)" }}
    />
  );
}

/**
 * The left pane — one gr8r inbox row per pending item (src/pages/inbox.js):
 * title, then a quiet meta line (where it came from · team) with the age
 * right-aligned. The selected row sits on `--surface-2`; hover is fill only.
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
    <ul role="listbox" aria-label="Triage queue" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        const team = item.space_id ? spaceNames.get(item.space_id) : null;
        return (
          <li key={item.id} role="option" aria-selected={selected}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className="col hover:bg-(--g8-surface-2) focus-visible:outline-none focus-visible:bg-(--g8-surface-2)"
              style={{
                width: "100%",
                gap: 4,
                padding: "12px var(--g8-gutter)",
                borderBottom: "1px solid var(--g8-divider)",
                textAlign: "left",
                position: "relative",
                background: selected ? "var(--g8-surface-2)" : undefined,
              }}
            >
              {selected ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    borderRadius: 2,
                    background: "var(--g8-accent)",
                  }}
                />
              ) : null}
              <span className="row" style={{ gap: 8, alignItems: "baseline" }}>
                <span
                  className={selected ? "trunc" : "trunc muted"}
                  style={{ flex: 1, fontWeight: 500, fontSize: 13 }}
                >
                  {item.title}
                </span>
                <span className="faint num" style={{ fontSize: 11.5, flexShrink: 0 }}>
                  {triageAge(item.created_at)}
                </span>
              </span>
              <span className="row" style={{ gap: 6, fontSize: 11.5, color: "var(--g8-text-3)", minWidth: 0 }}>
                <IntakeIcon intake={item.intake} />
                <span className="trunc">{item.intake.label}</span>
                {team ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="trunc" style={{ flexShrink: 0 }}>
                      {team}
                    </span>
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
