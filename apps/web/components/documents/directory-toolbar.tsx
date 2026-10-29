"use client";

import { LayoutGrid, List, Search, X } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { NewDocumentMenu } from "./quick-create-row";

/* ────────────────────────────────────────────────────────────────────────── */
/*  The Directory's view state — one type, shared with `documents-home`       */
/* ────────────────────────────────────────────────────────────────────────── */

export type DirectoryKind = "all" | "doc" | "sheet";
export type DirectorySort = "recent" | "created" | "title";
/** `"all"` · `"general"` (no team) · a space id. */
export type DirectoryTeam = string;

export type DirectoryView = {
  query: string;
  kind: DirectoryKind;
  team: DirectoryTeam;
  sort: DirectorySort;
};

export const DEFAULT_DIRECTORY_VIEW: DirectoryView = {
  query: "",
  kind: "all",
  team: "all",
  sort: "recent",
};

const KIND_LABEL: Record<DirectoryKind, string> = {
  all: "All types",
  doc: "Documents",
  sheet: "Spreadsheets",
};

const SORT_LABEL: Record<DirectorySort, string> = {
  recent: "Recently edited",
  created: "Recently created",
  title: "Title A–Z",
};

export type TeamOption = { id: string; name: string; icon: string | null; count: number };

/** Grid of `.fcard`s or a `.panel` of `.mini` rows (gr8r's file view toggle). */
export type DirectoryLayout = "grid" | "list";

const SELECT_STYLE = { height: 26, width: "auto", fontSize: 12 } as const;

/**
 * The Directory's one control bar — gr8r's Files `.toolbar` row (search
 * `.inwrap`, native `.select` filters, a grid / list `.seg`, then the primary
 * create). Find, narrow, order, create — in that order, because on a library
 * of documents *finding* is the primary act and creating is the occasional
 * one. Native selects keep the bar's height constant however many teams a
 * property has, so it can stick to the top of the scroller.
 */
export function DirectoryToolbar({
  propertyId,
  view,
  onChange,
  teams,
  generalCount,
  onGenerate,
  resultCount,
  layout,
  onLayout,
}: {
  propertyId: string;
  view: DirectoryView;
  onChange: (next: Partial<DirectoryView>) => void;
  teams: TeamOption[];
  generalCount: number;
  onGenerate: () => void;
  /** Rendered beside the search field while a query is active. */
  resultCount: number | null;
  layout: DirectoryLayout;
  onLayout: (l: DirectoryLayout) => void;
}) {
  const filtered = view.kind !== "all" || view.team !== "all";

  return (
    <div className="row g8-doc-toolbar">
      <div className="inwrap" style={{ position: "relative" }}>
        <Gi icon={Search} size={13} />
        <input
          type="search"
          className="input search-sm g8-doc-search"
          value={view.query}
          onChange={(e) => onChange({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") onChange({ query: "" });
          }}
          placeholder="Search title and body…"
          aria-label="Search documents"
        />
        {view.query ? (
          <button
            type="button"
            className="ibtn ibtn-xs g8-doc-clear"
            onClick={() => onChange({ query: "" })}
            aria-label="Clear search"
          >
            <Gi icon={X} size={12} />
          </button>
        ) : null}
      </div>

      {resultCount !== null ? (
        <span aria-live="polite" className="faint num" style={{ fontSize: 12 }}>
          {resultCount} {resultCount === 1 ? "result" : "results"}
        </span>
      ) : null}

      <select
        className="select"
        style={SELECT_STYLE}
        aria-label="Filter by type"
        value={view.kind}
        onChange={(e) => onChange({ kind: e.target.value as DirectoryKind })}
      >
        {(Object.keys(KIND_LABEL) as DirectoryKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>

      {teams.length > 0 ? (
        <select
          className="select"
          style={SELECT_STYLE}
          aria-label="Filter by team"
          value={view.team}
          onChange={(e) => onChange({ team: e.target.value })}
        >
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.icon ? `${t.icon} ` : ""}
              {t.name} ({t.count})
            </option>
          ))}
          {generalCount > 0 ? (
            <option value="general">General ({generalCount})</option>
          ) : null}
        </select>
      ) : null}

      <select
        className="select"
        style={SELECT_STYLE}
        aria-label="Sort"
        value={view.sort}
        onChange={(e) => onChange({ sort: e.target.value as DirectorySort })}
      >
        {(Object.keys(SORT_LABEL) as DirectorySort[]).map((s) => (
          <option key={s} value={s}>
            Sort: {SORT_LABEL[s]}
          </option>
        ))}
      </select>

      {filtered ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange({ kind: "all", team: "all" })}
        >
          Clear
        </button>
      ) : null}

      <span className="sp" />

      <div className="seg" role="group" aria-label="Layout">
        {(
          [
            ["grid", LayoutGrid],
            ["list", List],
          ] as const
        ).map(([k, icon]) => (
          <button
            key={k}
            type="button"
            className={layout === k ? "on" : ""}
            aria-label={`${k} view`}
            aria-pressed={layout === k}
            onClick={() => onLayout(k)}
          >
            <Gi icon={icon} size={13} />
          </button>
        ))}
      </div>

      <NewDocumentMenu propertyId={propertyId} onGenerate={onGenerate} />
    </div>
  );
}
