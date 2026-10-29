"use client";

import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown, Folder, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PageHeader } from "@/components/shell/page-header";
import type { BreadcrumbItem } from "@/components/shell/breadcrumbs";
import type { EntityColor, ProjectStatus } from "@/lib/db/types";
import { Gi } from "./icon";
import { Av, G8_COLOR } from "./home-glyphs";

/**
 * gr8r-studio's project page chrome (src/pages/project.js `pageProject`):
 * the app topbar (`PageHeader`) → `.page.flush` › `.proj-h` (icon, name,
 * status pill, members, actions) › `.tabs` → `.pbody`. Plus the small gr8r
 * pieces the project views share: `G8Panel` (`.panel` + `.panel-h`), the
 * status / lead / teams pickers in gr8r's `.pillbtn` vocabulary.
 */

export type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

/** Project status → gr8r PSTAT (same names + colours as the sidebar dot). */
export const PROJECT_STATUS: Record<ProjectStatus, { name: string; c: string }> = {
  planned: { name: "Planning", c: "var(--g8-gray)" },
  active: { name: "In Progress", c: "var(--g8-blue)" },
  completed: { name: "Completed", c: "var(--g8-green)" },
  archived: { name: "Archived", c: "var(--g8-gray)" },
};
const STATUS_ORDER: ProjectStatus[] = ["planned", "active", "completed", "archived"];

export type ProjectTabDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
};

export function ProjectPageShell({
  crumbs,
  topActions,
  icon,
  title,
  star,
  status,
  members,
  headActions,
  tabs,
  active,
  onTab,
  children,
}: {
  crumbs: BreadcrumbItem[];
  topActions?: React.ReactNode;
  icon: React.ReactNode;
  title: React.ReactNode;
  /** gr8r's favorite star, right after the title. */
  star?: React.ReactNode;
  status: React.ReactNode;
  members?: React.ReactNode;
  headActions?: React.ReactNode;
  tabs: ProjectTabDef[];
  active: string;
  onTab: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader breadcrumbs={crumbs} actions={topActions} />
      <div className="page flush" style={{ minHeight: 0, flex: 1 }}>
        <div className="proj-h">
          <div className="t">
            {icon}
            {title}
            {star}
            {status}
            <span className="sp" />
            <div className="row" style={{ gap: 4 }}>
              {members}
              {headActions}
            </div>
          </div>
          <nav className="tabs" aria-label="Project views">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={t.id === active ? "page" : undefined}
                className={t.id === active ? "tab on" : "tab"}
                onClick={() => onTab(t.id)}
              >
                <Gi icon={t.icon} size={14} />
                {t.label}
                {typeof t.count === "number" && t.count > 0 ? (
                  <span className="cnt num">{t.count}</span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
        <div className="pbody" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** gr8r `pIcon(p, 'lg')` — the project's emoji or a folder on its tint. */
export function ProjectIcon({
  icon,
  color,
  lg,
}: {
  icon: string | null;
  color: EntityColor;
  lg?: boolean;
}) {
  return (
    <span className={lg ? "picon lg" : "picon"} style={{ "--g8-c": G8_COLOR[color] } as CSSVars}>
      {icon ? (
        <span style={{ fontSize: lg ? 18 : 14, lineHeight: 1 }}>{icon}</span>
      ) : (
        <Gi icon={Folder} size={lg ? 18 : 14} />
      )}
    </span>
  );
}

/** gr8r `.panel` with its `.panel-h` (title · count · acts) and `.panel-b`. */
export function G8Panel({
  title,
  count,
  acts,
  children,
  flush,
}: {
  title: string;
  count?: React.ReactNode;
  acts?: React.ReactNode;
  children: React.ReactNode;
  /** Rows that pad themselves (`.mini` lists) — no `.panel-b` wrapper. */
  flush?: boolean;
}) {
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>{title}</h2>
        {count !== undefined && count !== null ? <span className="faint num">{count}</span> : null}
        {acts ? <div className="acts">{acts}</div> : null}
      </div>
      {flush ? children : <div className="panel-b">{children}</div>}
    </section>
  );
}

/** The header's status pill (gr8r `pillbtn bordered` + dot + chevron). */
export function ProjectStatusMenu({
  status,
  onSelect,
  bordered = true,
}: {
  status: ProjectStatus;
  onSelect: (s: ProjectStatus) => void;
  bordered?: boolean;
}) {
  const meta = PROJECT_STATUS[status];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={bordered ? "pillbtn bordered" : "pillbtn"}
            aria-label="Project status"
            style={{ height: 24 }}
          />
        }
      >
        <span className="pstatus" style={{ "--g8-c": meta.c, border: 0, padding: 0, height: "auto" } as CSSVars}>
          <i />
          {meta.name}
        </span>
        <Gi icon={ChevronDown} size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6}>
        {STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onSelect(s)}>
            <span
              className="pstatus"
              style={{ "--g8-c": PROJECT_STATUS[s].c, border: 0, padding: 0 } as CSSVars}
            >
              <i />
            </span>
            <span className="flex-1">{PROJECT_STATUS[s].name}</span>
            {s === status ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Person = { id: string; name: string | null; avatarUrl: string | null };

/** The project lead — one accountable person (gr8r's Details › Lead row). */
export function LeadPicker({
  people,
  leadId,
  onSelect,
}: {
  people: Person[];
  leadId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const lead = leadId ? people.find((p) => p.id === leadId) : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className={lead ? "pillbtn" : "pillbtn empty"} />}
      >
        {lead ? (
          <>
            <Av member={lead} />
            <span className="trunc">{lead.name ?? "Member"}</span>
          </>
        ) : (
          "No lead"
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="max-h-72 overflow-y-auto">
        {people.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onSelect(p.id)}>
            <Av member={p} />
            <span className="flex-1 truncate">{p.name ?? "Member"}</span>
            {p.id === leadId ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        {leadId ? (
          <DropdownMenuItem onClick={() => onSelect(null)}>
            <span className="flex-1 text-muted-foreground">Clear lead</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Team = { id: string; name: string; color: EntityColor };

/** Details › Teams: linked teams as pills + a picker to link / unlink. */
export function TeamsPicker({
  allSpaces,
  linkedSpaces,
  onToggle,
  hrefOf,
}: {
  allSpaces: Team[];
  linkedSpaces: Team[];
  onToggle: (spaceId: string) => void;
  hrefOf: (spaceId: string) => string;
}) {
  const linkedIds = new Set(linkedSpaces.map((s) => s.id));
  return (
    <>
      {linkedSpaces.map((s) => (
        <a key={s.id} href={hrefOf(s.id)} className="pillbtn">
          <span className="pdot" style={{ "--g8-c": G8_COLOR[s.color], borderRadius: "50%" } as CSSVars} />
          {s.name || "Untitled team"}
        </a>
      ))}
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="pillbtn empty"
              aria-label={linkedSpaces.length ? "Edit teams" : "Add teams"}
            />
          }
        >
          {linkedSpaces.length ? <Gi icon={Plus} size={13} /> : "Add teams"}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-56 p-1.5">
          {allSpaces.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-faint-foreground">
              No teams yet — create one in the sidebar.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col overflow-y-auto">
              {allSpaces.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(s.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className="pdot" style={{ "--g8-c": G8_COLOR[s.color], borderRadius: "50%" } as CSSVars} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {linkedIds.has(s.id) ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

/** "Mar 4, 2026" (gr8r `fmtDate(d, true)`), or null. */
export function fmtDay(value: string | null | undefined, year = true): string | null {
  if (!value) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? (() => {
        const [y, m, dd] = value.split("-").map(Number);
        return new Date(y!, (m ?? 1) - 1, dd ?? 1);
      })()
    : new Date(value);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
  });
}
