import type { InitiativeStatus } from "@/lib/db/types";

export const INITIATIVE_STATUSES: InitiativeStatus[] = ["planned", "active", "completed"];

/** Same dot tokens as the project status ramp, so the two read as one family. */
export const INITIATIVE_STATUS_META: Record<
  InitiativeStatus,
  {
    label: string;
    dot: string;
    tone: "info" | "success" | "violet";
    /** gr8r ink for the `.pstatus` dot. */
    c: string;
  }
> = {
  planned: { label: "Planned", dot: "bg-info", tone: "info", c: "var(--g8-gray)" },
  active: { label: "Active", dot: "bg-success", tone: "success", c: "var(--g8-blue)" },
  completed: { label: "Completed", dot: "bg-pill-violet-ink", tone: "violet", c: "var(--g8-green)" },
};
