"use client";

import { useMemo, useState } from "react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import Link from "next/link";
import { FileText, Pin, Plus, Search, X } from "lucide-react";
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
  default: {
    shell: "h-48 w-40 rounded-lg",
    pad: "p-3",
    title: "pr-6 text-sm",
    body: "text-sm line-clamp-5",
    footer: "px-3 py-2 text-sm",
    snippetLines: 500,
  },
  compact: {
    shell: "h-[7.5rem] w-[6.75rem] rounded-md",
    pad: "p-2",
    title: "pr-5 text-[0.6875rem] leading-snug",
    body: "text-[0.625rem] line-clamp-2",
    footer: "px-2 py-1 text-[0.625rem]",
    snippetLines: 120,
  },
};

/** Page-thumbnail card — shared by docs-home boards and space resource pins. */
export function DocPinCard({
  doc,
  propertyId,
  accentDotClass,
  onUnpin,
  showPresence = true,
  size = "default",
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

  return (
    <div
      ref={wrapperRef}
      style={wrapperStyle}
      className={cn("group/card relative shrink-0", isDragging && "opacity-40")}
      {...dragAttributes}
      {...dragListeners}
    >
      <Link
        href={documentHref(propertyId, doc.id)}
        onClick={handleClick}
        onMouseEnter={() => prewarm(doc.id)}
        draggable={false}
        className={cn(
          "flex flex-col overflow-hidden border border-border/80 bg-card text-left",
          s.shell,
          draggable
            ? "cursor-grab active:cursor-grabbing group-hover/card:border-foreground/30 group-hover/card:bg-muted/40 group-hover/card:shadow-md group-hover/card:shadow-foreground/5 dark:group-hover/card:inset-ring-white/10"
            : "hover:border-foreground/30 hover:bg-muted/40",
          "dark:inset-ring dark:inset-ring-white/5",
        )}
      >
        <div className={cn("flex-1 overflow-hidden", s.pad)}>
          <h3 className={cn("line-clamp-2 font-medium text-foreground", s.title)}>
            {doc.title || "Untitled"}
          </h3>
          <div className={cn("bg-border/50", size === "compact" ? "my-1 h-px" : "my-2 h-px")} />
          {snippet ? (
            <p className={cn("whitespace-pre-line text-muted-foreground", s.body)}>
              {snippet}
            </p>
          ) : (
            <p className={cn("text-muted-foreground/70", s.body)}>Empty</p>
          )}
        </div>
        <div
          className={cn(
            "flex items-center justify-between gap-1 border-t border-border/50",
            s.footer,
          )}
        >
          <span className="flex min-w-0 items-center gap-1">
            <span
              className={cn("size-1 shrink-0 rounded-full", accentDotClass)}
              aria-hidden="true"
            />
            <span className="truncate text-muted-foreground tabular-nums">
              {doc.updated_at ? relativeTime(doc.updated_at) : "—"}
            </span>
          </span>
          {showPresence && size === "default" ? (
            <DocumentViewerAvatarStack users={viewers} size={18} />
          ) : null}
        </div>
      </Link>

      <button
        type="button"
        aria-label="Unpin"
        title="Unpin"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={handleUnpinClick}
        className={cn(
          "absolute flex items-center justify-center rounded border border-border/60 bg-card/95 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm",
          size === "compact"
            ? "top-1 right-1 size-5"
            : "top-1.5 right-1.5 size-6",
          "group-hover/card:opacity-100 focus-visible:opacity-100",
          "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring/60",
        )}
      >
        <X strokeWidth={2} className={size === "compact" ? "size-3" : "size-3.5"} />
      </button>
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
        "flex shrink-0 flex-col items-center justify-center border border-dashed text-center",
        size === "compact"
          ? "h-[7.5rem] w-[6.75rem] gap-1 rounded-md px-2"
          : "h-48 w-40 gap-2 rounded-lg px-4",
        disabled
          ? "cursor-not-allowed border-border/30 text-muted-foreground/40"
          : "border-border/60 text-muted-foreground hover:border-foreground/25 hover:bg-muted/20 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full bg-muted/60",
          size === "compact" ? "size-6" : "size-8",
        )}
        aria-hidden="true"
      >
        <Plus
          strokeWidth={1.75}
          className={size === "compact" ? "size-3.5" : "size-4"}
        />
      </span>
      <span
        className={cn(
          "font-medium",
          size === "compact" ? "text-[0.625rem] leading-tight" : "text-xs",
        )}
      >
        {label}
      </span>
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
    if (inSpace.length > 0) result.push({ label: "In this space", items: inSpace });
    if (workspace.length > 0) {
      result.push({
        label: "From workspace",
        hint: "Adds to this space",
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
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
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
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
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
      <p className="px-2 py-1 text-[0.6875rem] font-medium tracking-tight text-muted-foreground">
        {label}
        {hint ? (
          <span className="ml-1 font-normal text-muted-foreground/70">
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
              className="flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-sm tracking-tight hover:bg-muted"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
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
