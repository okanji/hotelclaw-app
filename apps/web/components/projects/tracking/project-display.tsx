"use client";

import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useFavorites } from "@/lib/favorites/use-favorites";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectStatus, UpdateHealth } from "@/lib/db/types";
import type { ProjectTracking } from "@/lib/query/project-queries";
import type { DeclaredHealthIndex } from "@/lib/query/initiative-queries";
import type { PropertyMilestone } from "@/lib/query/milestone-queries";
import { updateProject } from "../actions";
import {
  PROJECT_STATUS_META,
  type ProjectMember,
  progressPct,
  projectHealth,
} from "./tracking-shared";

/* -------------------------------------------------------------------------- */
/* Linear's Projects page vocabulary, shared by List + Timeline: the display  */
/* options (layout, grouping, ordering, closed projects, properties), the    */
/* health / status glyphs, grouping, and the per-row "…" menu (gr8r's).      */
/* -------------------------------------------------------------------------- */

/** gr8r's Grid / List / Table plus our Board and Timeline. */
export type ProjectsLayout = "grid" | "list" | "table" | "board" | "timeline";
export type ProjectsGrouping = "status" | "health" | "lead" | "none";
export type ProjectsOrdering = "name" | "target" | "progress";
export type TimelineZoom = "month" | "quarter" | "year";
export type ListProperty = "milestone" | "health" | "lead" | "target" | "issues" | "status";

export type ProjectsDisplay = {
  layout: ProjectsLayout;
  grouping: ProjectsGrouping;
  ordering: ProjectsOrdering;
  showCompleted: boolean;
  zoom: TimelineZoom;
  properties: ListProperty[];
  panel: boolean;
};

export const LIST_PROPERTIES: { id: ListProperty; label: string }[] = [
  { id: "milestone", label: "Milestone" },
  { id: "health", label: "Health" },
  { id: "lead", label: "Lead" },
  { id: "target", label: "Target date" },
  { id: "issues", label: "Tasks" },
  { id: "status", label: "Status" },
];

const DEFAULT_DISPLAY: ProjectsDisplay = {
  layout: "grid",
  grouping: "status",
  ordering: "name",
  showCompleted: true,
  zoom: "quarter",
  properties: LIST_PROPERTIES.map((p) => p.id),
  panel: false,
};

/* Persisted per device — one external store so the popover, the views and
   the panel never disagree mid-edit (same shape as `use-nav-prefs.ts`). */
const KEY = "projects:display:v1";
let cached: ProjectsDisplay | null = null;
const listeners = new Set<() => void>();

function read(): ProjectsDisplay {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    cached = raw ? { ...DEFAULT_DISPLAY, ...(JSON.parse(raw) as Partial<ProjectsDisplay>) } : DEFAULT_DISPLAY;
  } catch {
    cached = DEFAULT_DISPLAY;
  }
  return cached;
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useProjectsDisplay() {
  const display = useSyncExternalStore(subscribe, read, () => DEFAULT_DISPLAY);
  const update = useCallback((patch: Partial<ProjectsDisplay>) => {
    cached = { ...read(), ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(cached));
    } catch {
      // Preference only.
    }
    for (const l of listeners) l();
  }, []);
  const reset = useCallback(() => update(DEFAULT_DISPLAY), [update]);
  return { display, update, reset };
}

/* ---------------------------------- Health -------------------------------- */

/** Health as Linear shows it: a person's latest update wins; otherwise the
 *  computed pace read (overdue ⇒ off track), and no target ⇒ no health. */
export type EffectiveHealth = UpdateHealth | "none";

export function effectiveHealth(
  p: ProjectTracking,
  declared: DeclaredHealthIndex | undefined,
): { health: EffectiveHealth; at: string | null } {
  const d = declared?.projects[p.id];
  if (d) return { health: d.health, at: d.at };
  const pace = projectHealth(p);
  const health: EffectiveHealth =
    pace === "overdue" ? "off_track" : pace === "at_risk" ? "at_risk" : pace === "none" ? "none" : "on_track";
  return { health, at: null };
}

export const HEALTH_LABEL: Record<EffectiveHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  none: "No updates",
};
const HEALTH_TONE: Record<EffectiveHealth, string> = {
  on_track: "bg-success/15 text-success",
  at_risk: "bg-warning/15 text-warning",
  off_track: "bg-destructive/15 text-destructive",
  none: "bg-muted text-faint-foreground",
};
export const HEALTH_TEXT: Record<EffectiveHealth, string> = {
  on_track: "text-success",
  at_risk: "text-warning",
  off_track: "text-destructive",
  none: "text-faint-foreground",
};

/** Linear's health chip: a tinted round badge with a trend glyph. */
export function HealthIcon({ health, className }: { health: EffectiveHealth; className?: string }) {
  const Icon = health === "off_track" ? TrendingDown : health === "at_risk" ? Check : TrendingUp;
  return (
    <span
      title={HEALTH_LABEL[health]}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full",
        HEALTH_TONE[health],
        className,
      )}
    >
      {health === "none" ? (
        <span className="size-1 rounded-full bg-current" />
      ) : (
        <Icon className="size-2.5" strokeWidth={3} />
      )}
    </span>
  );
}

/** "5w" / "3d" / "now" — how stale a declared health is. */
export function ageShort(iso: string | null): string | null {
  if (!iso) return null;
  const mins = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (mins < 60) return "now";
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/* ---------------------------------- Status -------------------------------- */

/** Linear's status glyph: a ring that fills as the project moves on. With
 *  `pct`, active projects draw their completion as a pie. */
export function StatusIcon({
  status,
  pct,
  className,
}: {
  status: ProjectStatus;
  pct?: number;
  className?: string;
}) {
  const meta = PROJECT_STATUS_META[status];
  const fill = status === "completed" ? 100 : status === "active" ? Math.max(pct ?? 50, 8) : 0;
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={cn(
        "relative flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-current",
        meta.text,
        status === "planned" && "border-dashed",
        status === "archived" && "opacity-60",
        className,
      )}
    >
      {fill > 0 ? (
        <span
          className="size-[7px] rounded-full"
          style={{ background: `conic-gradient(currentColor ${fill * 3.6}deg, transparent 0)` }}
        />
      ) : null}
    </span>
  );
}

/* --------------------------------- Grouping ------------------------------- */

export type ProjectGroup = {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** Tint for the group header bar (Linear tints by status colour). */
  tint: string;
  /** Status a "+" in this group would create with (status grouping only). */
  rows: ProjectTracking[];
};

const STATUS_GROUP_ORDER: ProjectStatus[] = ["active", "planned", "completed", "archived"];
const STATUS_TINT: Record<ProjectStatus, string> = {
  active: "bg-success/[0.07]",
  planned: "bg-info/[0.07]",
  completed: "bg-pill-violet/40",
  archived: "bg-muted",
};
const HEALTH_ORDER: EffectiveHealth[] = ["off_track", "at_risk", "on_track", "none"];
const HEALTH_TINT: Record<EffectiveHealth, string> = {
  off_track: "bg-destructive/[0.07]",
  at_risk: "bg-warning/[0.07]",
  on_track: "bg-success/[0.07]",
  none: "bg-muted",
};

export function sortProjects(projects: ProjectTracking[], ordering: ProjectsOrdering) {
  const byName = (a: ProjectTracking, b: ProjectTracking) =>
    (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  return [...projects].sort((a, b) => {
    if (ordering === "target") {
      const ta = a.target_date ?? "9999";
      const tb = b.target_date ?? "9999";
      return ta === tb ? byName(a, b) : ta < tb ? -1 : 1;
    }
    if (ordering === "progress") {
      const d = progressPct(b.done, b.total) - progressPct(a.done, a.total);
      return d !== 0 ? d : byName(a, b);
    }
    return byName(a, b);
  });
}

export function groupProjects(
  projects: ProjectTracking[],
  display: Pick<ProjectsDisplay, "grouping" | "ordering">,
  ctx: { members: ProjectMember[]; declared: DeclaredHealthIndex | undefined },
): ProjectGroup[] {
  const sorted = sortProjects(projects, display.ordering);
  switch (display.grouping) {
    case "none":
      return [{ key: "all", label: "All projects", icon: null, tint: "bg-muted", rows: sorted }];
    case "health":
      return HEALTH_ORDER.map((h) => ({
        key: h,
        label: HEALTH_LABEL[h],
        icon: <HealthIcon health={h} />,
        tint: HEALTH_TINT[h],
        rows: sorted.filter((p) => effectiveHealth(p, ctx.declared).health === h),
      })).filter((g) => g.rows.length > 0);
    case "lead": {
      const byId = new Map(ctx.members.map((m) => [m.id, m]));
      const keys = [...new Set(sorted.map((p) => p.lead_user_id ?? ""))].sort((a, b) =>
        !a ? 1 : !b ? -1 : (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? ""),
      );
      return keys.map((k) => ({
        key: k || "none",
        label: k ? (byId.get(k)?.name ?? "Member") : "No lead",
        icon: null,
        tint: "bg-muted",
        rows: sorted.filter((p) => (p.lead_user_id ?? "") === k),
      }));
    }
    default:
      return STATUS_GROUP_ORDER.map((s) => ({
        key: s,
        label: PROJECT_STATUS_META[s].label,
        icon: <StatusIcon status={s} />,
        tint: STATUS_TINT[s],
        rows: sorted.filter((p) => p.status === s),
      })).filter((g) => g.rows.length > 0);
  }
}

/** The next unreached milestone (earliest due; undated last). */
export function nextMilestone(milestones: PropertyMilestone[] | undefined) {
  if (!milestones) return null;
  const open = milestones.filter((m) => !m.completed_at);
  open.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  return open[0] ?? null;
}

/* ------------------------------ Row "…" menu ------------------------------ */

export function ProjectRowMenu({
  project,
  href,
  onChanged,
  className,
  bare,
  onOpen,
  propertyId,
}: {
  project: ProjectTracking;
  href: string;
  onChanged: () => void;
  className?: string;
  /** Use `className` as the trigger's ONLY classes (gr8r's `.ibtn`). */
  bare?: boolean;
  /** Open in place (the projects surface's pushState) instead of a reload. */
  onOpen?: () => void;
  /** When set, the menu offers gr8r's "Add to favorites" (`favorites`, 0120). */
  propertyId?: string;
}) {
  async function setStatus(status: ProjectStatus) {
    const res = await updateProject(project.id, { status });
    if ("error" in res) toast.error(res.error);
    else onChanged();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Options for ${project.name}`}
            onClick={(e) => e.stopPropagation()}
            className={
              bare
                ? className
                : cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md text-faint-foreground transition-colors hover:bg-accent hover:text-foreground",
                    className,
                  )
            }
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => (onOpen ? onOpen() : window.location.assign(href))}>
          <ArrowUpRight />
          Open project
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <StatusIcon status={project.status} />
            Status
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={project.status}
              onValueChange={(v) => void setStatus(v as ProjectStatus)}
            >
              {STATUS_GROUP_ORDER.filter((s) => s !== "archived").map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  <StatusIcon status={s} />
                  {PROJECT_STATUS_META[s].label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {propertyId ? (
          <FavoriteMenuItem propertyId={propertyId} projectId={project.id} name={project.name} />
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard
              .writeText(new URL(href, window.location.origin).toString())
              .then(() => toast.success("Link copied"));
          }}
        >
          <Link2 />
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A compact labelled select for the display popover (Linear's pill menus). */
export function OptionMenu<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  const current = options.find((o) => o.id === value)?.label ?? value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-muted px-2 text-sm text-foreground transition-colors hover:bg-accent"
          />
        }
      >
        {current}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FavoriteMenuItem({
  propertyId,
  projectId,
  name,
}: {
  propertyId: string;
  projectId: string;
  name: string;
}) {
  const { isFavorite, toggle } = useFavorites(propertyId);
  const on = isFavorite("project", projectId);
  return (
    <DropdownMenuItem onClick={() => void toggle("project", projectId, name)}>
      <Star />
      {on ? "Remove from favorites" : "Add to favorites"}
    </DropdownMenuItem>
  );
}
