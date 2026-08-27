"use client";

import { useMemo, useState } from "react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import Link from "next/link";
import { FileText, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { documentHref } from "@/lib/documents/document-href";
import { DocumentViewerAvatarStack } from "@/components/documents/document-presence-stack";
import { useDocsHomePresence } from "@/components/documents/docs-home-presence";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";

export type DocPinCardData = {
  id: string;
  title: string;
  updated_at: string;
  body_text?: string | null;
};

type PinCandidate = { id: string; title: string };

export const MAX_PINNED_RESOURCES = 8;

export type DocPinCardSize = "default" | "compact";

const CARD_SHELL: Record<
  DocPinCardSize,
  { shell: string; pad: string; title: string; body: string; footer: string; snippetLines: number }
> = {
  // A gallery card IS a page: 10px `rounded-card` rung + `shadow-card`, and
  // its TITLE is content (16px/24, weight 400) rather than a 14px UI label
  // (notion-spec-v2 §2/§5).
  default: {
    shell: "h-48 w-40 rounded-card",
    pad: "px-2.5 py-2",
    title: "pr-6 text-base leading-6 font-normal",
    body: "text-sm line-clamp-5",
    footer: "px-2.5 py-2 text-sm",
    snippetLines: 500,
  },
  // Compact (team overviews) follows the Beautiful UI card anatomy
  // (.claude/skills/beautiful-ui-style, §2): a header BAR carrying the
  // accent dot, a tiny stroke icon, and right-aligned tabular meta over a
  // hairline — then the title + snippet as the body. Wider than the old
  // 6.75rem tile so titles stop wrapping into confetti; the thumbnail rung
  // keeps the 14px UI title (never below the 12px floor anywhere).
  compact: {
    shell: "h-[7.5rem] w-44 rounded-card",
    pad: "px-2.5 py-1.5",
    title: "text-sm leading-snug font-medium",
    body: "text-xs line-clamp-2",
    footer: "",
    snippetLines: 120,
  },
};

/** Capped entrance stagger (skill §1.3): items after the 7th share a beat. */
function entranceStyle(index: number | undefined): React.CSSProperties | undefined {
  if (index === undefined) return undefined;
  return { animationDelay: `${Math.min(index, 7) * 70}ms` };
}

/** Page-thumbnail card — shared by docs-home boards and space resource pins. */
export function DocPinCard({
  doc,
  propertyId,
  accentDotClass,
  onUnpin,
  showPresence = true,
  size = "default",
  /** Position in its group — drives the staggered fade-up entrance. */
  index,
  draggable = false,
  isDragging = false,
  wrapperRef,
  wrapperStyle,
  dragAttributes,
  dragListeners,
}: {
  doc: DocPinCardData;
  propertyId: string;
  accentDotClass: string;
  onUnpin: (documentId: string) => void;
  showPresence?: boolean;
  size?: DocPinCardSize;
  index?: number;
  draggable?: boolean;
  isDragging?: boolean;
  wrapperRef?: (node: HTMLElement | null) => void;
  wrapperStyle?: React.CSSProperties;
  dragAttributes?: DraggableAttributes;
  dragListeners?: SyntheticListenerMap;
}) {
  const openDocument = useOpenDocument(propertyId);
  const prewarm = usePrewarmDocument(propertyId);
  const viewers = useDocsHomePresence(doc.id);
  const s = CARD_SHELL[size];
  const snippet = doc.body_text?.trim().slice(0, s.snippetLines) ?? "";

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(doc.id);
  }

  function handleUnpinClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    onUnpin(doc.id);
  }

  const linkClass = cn(
    "flex flex-col overflow-hidden bg-card text-left shadow-card transition-colors",
    s.shell,
    draggable
      ? "cursor-grab active:cursor-grabbing group-hover/card:bg-accent"
      : "hover:bg-accent",
  );

  const unpinButton = (
    <button
      type="button"
      aria-label="Unpin"
      title="Unpin"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleUnpinClick}
      className={cn(
        "absolute flex items-center justify-center rounded-md text-faint-foreground opacity-0 transition-colors",
        size === "compact"
          ? "top-1 right-1 size-5 bg-card"
          : "top-1.5 right-1.5 size-6 bg-card",
        "group-hover/card:opacity-100 focus-visible:opacity-100",
        "hover:bg-destructive/10 hover:text-destructive",
        "focus-visible:outline-none focus-visible:shadow-focus",
      )}
    >
      <X strokeWidth={2} className={size === "compact" ? "size-3" : "size-3.5"} />
    </button>
  );

  if (size === "compact") {
    // Beautiful UI card anatomy: header bar (accent dot · icon · tabular
    // time over a hairline) + title/snippet body. The bar's time yields to
    // the unpin control on hover — one corner, two states, no overlap.
    return (
      <div
        ref={wrapperRef}
        style={{ ...wrapperStyle, ...entranceStyle(index) }}
        className={cn(
          "group/card relative shrink-0",
          index !== undefined && "ai-fade-up",
          isDragging && "opacity-40",
        )}
        {...dragAttributes}
        {...dragListeners}
      >
        <Link
          href={documentHref(propertyId, doc.id)}
          onClick={handleClick}
          onMouseEnter={() => prewarm(doc.id)}
          draggable={false}
          className={linkClass}
        >
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border px-2">
            {/* Blue document mark — the tint palette is the sanctioned
                decorative blue (primary blue stays reserved for actions).
                Same tiny-square-badge grammar as Beautiful UI's chips. */}
            <span
              className="flex size-4.5 shrink-0 items-center justify-center rounded-[4px] bg-tint-blue text-tint-blue-ink"
              aria-hidden="true"
            >
              <FileText className="size-3" strokeWidth={2.25} />
            </span>
            <span
              className={cn("size-1.5 shrink-0 rounded-full", accentDotClass)}
              aria-hidden="true"
            />
            <span className="ml-auto truncate text-xs text-faint-foreground tabular-nums transition-opacity group-hover/card:opacity-0">
              {doc.updated_at ? relativeTime(doc.updated_at) : "—"}
            </span>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-hidden", s.pad)}>
            <h3 className={cn("line-clamp-2 text-foreground", s.title)}>
              {doc.title || "Untitled"}
            </h3>
            {snippet ? (
              <p
                className={cn(
                  "mt-1 whitespace-pre-line text-muted-foreground",
                  s.body,
                )}
              >
                {snippet}
              </p>
            ) : (
              <p className={cn("mt-1 text-faint-foreground", s.body)}>Empty</p>
            )}
          </div>
        </Link>
        {unpinButton}
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={{ ...wrapperStyle, ...entranceStyle(index) }}
      className={cn(
        "group/card relative shrink-0",
        index !== undefined && "ai-fade-up",
        isDragging && "opacity-40",
      )}
      {...dragAttributes}
      {...dragListeners}
    >
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(doc.id)}
        draggable={false}
        className={linkClass}
      >
        <div className={cn("flex-1 overflow-hidden", s.pad)}>
          <h3 className={cn("line-clamp-2 pr-6 text-foreground", s.title)}>
            {doc.title || "Untitled"}
          </h3>
          <div className="my-2 h-px bg-border" />
          {snippet ? (
            <p className={cn("whitespace-pre-line text-muted-foreground", s.body)}>
              {snippet}
            </p>
          ) : (
            <p className={cn("text-faint-foreground", s.body)}>Empty</p>
          )}
        </div>
        <div
          className={cn(
            "flex items-center justify-between gap-1 border-t border-border",
            s.footer,
          )}
        >
          <span className="flex min-w-0 items-center gap-1">
            <span
              className={cn("size-1 shrink-0 rounded-full", accentDotClass)}
              aria-hidden="true"
            />
            <span className="truncate text-faint-foreground tabular-nums">
              {doc.updated_at ? relativeTime(doc.updated_at) : "—"}
            </span>
          </span>
          {showPresence ? (
            <DocumentViewerAvatarStack users={viewers} size={18} />
          ) : null}
        </div>
      </Link>
      {unpinButton}
    </div>
  );
}

/** Clickable dashed tile — opens the pin picker (replaces drag-only drop slots). */
export function AddPinTile({
  onClick,
  disabled,
  label = "Pin document",
  size = "default",
}: {
  onClick?: () => void;
  disabled?: boolean;
  label?: string;
  size?: DocPinCardSize;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // No dashed box and no icon plate — the well IS the affordance
        // (DESIGN.md "Primitives": EmptyState / never a dashed gray box).
        "flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-md bg-muted text-center transition-colors",
        size === "compact"
          ? "h-[7.5rem] w-[6.75rem] px-2"
          : "h-48 w-40 px-4",
        disabled
          ? "cursor-not-allowed text-faint-foreground opacity-60"
          : "text-muted-foreground hover:bg-accent-pressed",
        "focus-visible:outline-none focus-visible:shadow-focus",
      )}
    >
      <Plus
        aria-hidden="true"
        strokeWidth={1.75}
        className={size === "compact" ? "size-4" : "size-5"}
      />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

/** Searchable picker — pin docs already in the space, or pull from the workspace. */
export type PinPickerGroup = {
  label: string;
  hint?: string;
  items: PinCandidate[];
};

export function DocumentPinPicker({
  spaceDocs,
  workspaceCandidates,
  groups,
  onPin,
  disabled,
  trigger,
  tileSize = "default",
}: {
  /** Used when `groups` is omitted — space overview picker. */
  spaceDocs?: PinCandidate[];
  workspaceCandidates?: PinCandidate[];
  /** Explicit groups (e.g. dashboard boards). Overrides space/workspace props. */
  groups?: PinPickerGroup[];
  onPin: (id: string) => void;
  disabled?: boolean;
  /** Defaults to a dashed `AddPinTile`. */
  trigger?: React.ReactElement;
  tileSize?: DocPinCardSize;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const match = (c: PinCandidate) =>
    !needle || (c.title || "").toLowerCase().includes(needle);

  const resolvedGroups = useMemo((): PinPickerGroup[] => {
    if (groups) {
      return groups
        .map((g) => ({ ...g, items: g.items.filter(match).slice(0, 12) }))
        .filter((g) => g.items.length > 0);
    }
    const result: PinPickerGroup[] = [];
    const inSpace = (spaceDocs ?? []).filter(match).slice(0, 12);
    const workspace = (workspaceCandidates ?? []).filter(match).slice(0, 12);
    if (inSpace.length > 0) result.push({ label: "In this team", items: inSpace });
    if (workspace.length > 0) {
      result.push({
        label: "From workspace",
        hint: "Adds to this team",
        items: workspace,
      });
    }
    return result;
  }, [groups, spaceDocs, workspaceCandidates, needle]);

  const empty = resolvedGroups.length === 0;

  function pick(id: string) {
    onPin(id);
    setOpen(false);
    setQ("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={trigger ?? <AddPinTile disabled={disabled} size={tileSize} />}
      />
      <PopoverContent align="start" sideOffset={8} className="w-80 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search documents…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="mt-1.5 max-h-72 overflow-y-auto">
          {empty ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {needle
                ? "No matches — try a different search"
                : "No documents available to pin"}
            </p>
          ) : (
            resolvedGroups.map((g) => (
              <PinPickerGroupRow
                key={g.label}
                label={g.label}
                hint={g.hint}
                items={g.items}
                onPick={pick}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PinPickerGroupRow({
  label,
  hint,
  items,
  onPick,
}: {
  label: string;
  hint?: string;
  items: PinCandidate[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="py-1">
      <p className="px-1.5 py-1 text-xs leading-3 font-medium text-faint-foreground">
        {label}
        {hint ? (
          <span className="ml-1 font-normal">
            · {hint}
          </span>
        ) : null}
      </p>
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className="flex min-h-7 w-full items-center gap-2 truncate rounded-md px-1.5 py-[3px] text-left text-sm/[1.2] transition-colors hover:bg-accent"
            >
              <FileText className="size-3.5 shrink-0 text-faint-foreground" />
              {c.title || "Untitled"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
