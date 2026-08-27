"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, FileText, Folder, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STARTER_PROMPTS } from "@/lib/assistant/types";
import { assistantProjectsQueryOptions } from "@/lib/query/assistant-queries";
import { documentsTreeQueryOptions } from "@/lib/query/section-queries";
import { cn } from "@/lib/utils";

/**
 * The message box. One component for both places it appears — centred on the
 * empty state (Claude's "Write a message…" card) and pinned to the bottom of
 * a running conversation — because two composers that drift apart is exactly
 * how a surface starts feeling assembled rather than designed.
 *
 * Auto-grows to a cap, then scrolls internally: a pasted brief should be
 * visible while you edit it, but must never push the transcript off screen.
 *
 * Reference picker: typing `@` opens a popup of the property's documents
 * (and assistant projects) filtered by what follows; picking one inserts a
 * plain-text `@"Title"` reference — the assistant reads workspace documents
 * by title (list_documents/read_document), so a quoted title genuinely
 * steers it. No rich chips: the model reads exactly what the user sees.
 * A `/` at the start of an empty input lists the starter prompts instead.
 * The @ menu needs `propertyId` to know whose documents to list — without
 * it the mention picker simply stays off (the prompt menu still works).
 */

type PickerRow = {
  id: string;
  label: string;
  section: "Documents" | "Projects" | "Prompts";
};

/**
 * The `@token` being typed at the caret, if any. The `@` must start the
 * input or follow whitespace (so emails never trigger), and the query may
 * contain spaces — document titles do. A newline, a second `@`, or an
 * implausibly long query means the user moved on: no token.
 */
function parseMentionToken(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const upToCaret = value.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upToCaret[at - 1]!)) return null;
  const query = upToCaret.slice(at + 1);
  // A quote means this is an already-inserted `@"Title"` reference (or the
  // user is quoting by hand) — either way, not a token being typed.
  if (
    query.length > 48 ||
    query.includes("\n") ||
    query.includes("@") ||
    query.includes('"')
  ) {
    return null;
  }
  return { start: at, query };
}

export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  placeholder = "Write a message…",
  autoFocus = false,
  size = "inline",
  trailing,
  propertyId,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * `inline` sits under a running conversation and should stay out of the
   * way. `hero` is the START of something — the home screen and a project's
   * page — where the composer IS the primary action and has to read that way
   * at a glance. The first cut used one size everywhere and the project
   * composer ended up the same height as the cards beside it, so it scanned
   * as another card rather than as the place you type.
   */
  size?: "inline" | "hero";
  /** Chips shown on the composer's bottom row (project, scope hints). */
  trailing?: React.ReactNode;
  /** Enables the @-mention document picker. Optional — omitted, the picker self-disables. */
  propertyId?: string;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuId = useId();

  // Auto-grow from the resting height. Reset to `auto` first or the box can
  // only ever get taller; floor at the resting height so a hero composer
  // doesn't collapse to one line the moment you type.
  const restingHeight = size === "hero" ? 88 : 24;
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, restingHeight), 320)}px`;
  }, [value, restingHeight]);

  // ── Reference picker state ───────────────────────────────────────────
  // The caret has to be tracked (onChange + onSelect) because the @token is
  // parsed at the caret, not at the end of the value — editing mid-message
  // must open the menu for the token being edited, not the last one typed.
  const [caret, setCaret] = useState(0);
  // Esc dismisses the CURRENT token only; a fresh `@` reopens. Keyed by the
  // token identity so continuing to type after Esc stays dismissed; the
  // onChange handler forgets the dismissal once the token itself is gone.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // The highlighted row, keyed to the list it was set on. A changed query
  // yields a different key, so the highlight snaps back to the top row by
  // derivation — no state-resetting effect.
  const [activePick, setActivePick] = useState<{
    key: string;
    index: number;
  } | null>(null);
  // Where the caret should land after a programmatic insert (the browser
  // parks it at the end when the value is replaced from outside). Cleared by
  // the next real edit; the DOM sync lives in an effect below.
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);

  // "/" at the start of the input lists starter prompts; otherwise look for
  // an @token at the caret. Slash needs no property; mentions do.
  const slashMode = value.startsWith("/") && !value.includes("\n");
  const mentionToken =
    !slashMode && propertyId ? parseMentionToken(value, caret) : null;
  const menuKey = slashMode
    ? "slash"
    : mentionToken
      ? `at:${mentionToken.start}`
      : null;
  const menu = menuKey && menuKey !== dismissedKey
    ? slashMode
      ? ("slash" as const)
      : ("at" as const)
    : null;
  const query = (slashMode ? value.slice(1) : (mentionToken?.query ?? ""))
    .trim()
    .toLowerCase();

  // Documents + projects load lazily — only once an @ menu actually opens —
  // and react-query keeps them warm for every open after the first.
  const docsQuery = useQuery({
    ...documentsTreeQueryOptions(propertyId ?? ""),
    enabled: !!propertyId && menu === "at",
  });
  const projectsQuery = useQuery({
    ...assistantProjectsQueryOptions(propertyId ?? ""),
    enabled: !!propertyId && menu === "at",
  });

  const rows: PickerRow[] =
    menu === "slash"
      ? STARTER_PROMPTS.filter((prompt) =>
          prompt.toLowerCase().includes(query),
        ).map((prompt, i) => ({
          id: `prompt-${i}`,
          label: prompt,
          section: "Prompts" as const,
        }))
      : menu === "at"
        ? [
            ...(docsQuery.data ?? [])
              .filter((doc) => doc.title.toLowerCase().includes(query))
              .slice(0, 15)
              .map((doc) => ({
                id: `doc-${doc.id}`,
                label: doc.title,
                section: "Documents" as const,
              })),
            ...(projectsQuery.data ?? [])
              .filter((project) => project.name.toLowerCase().includes(query))
              .slice(0, 5)
              .map((project) => ({
                id: `project-${project.id}`,
                label: project.name,
                section: "Projects" as const,
              })),
          ]
        : [];

  const loading =
    menu === "at" && (docsQuery.isLoading || projectsQuery.isLoading);
  // No matches ⇒ no popup: the user is probably just writing a sentence
  // past a stale @, and a stuck "no results" box would fight the typing.
  const open = menu !== null && (rows.length > 0 || loading);

  // The highlight is derived: stored index if it was set on THIS list,
  // clamped in case the list shrank under it; top row otherwise.
  const listKey = `${menu ?? "none"}:${query}`;
  const active =
    activePick && activePick.key === listKey && rows.length > 0
      ? Math.min(activePick.index, rows.length - 1)
      : 0;
  const setActive = (index: number) => setActivePick({ key: listKey, index });

  // Keep the active row visible as ↑↓ walk a list taller than the popup.
  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${menuId}-opt-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active, menuId]);

  // Selection replaced the value from outside the textarea's own editing,
  // so the browser parked the caret at the end — move it where the insert
  // ended. Pure DOM sync; `pendingCaret` is cleared by the next real edit.
  useEffect(() => {
    if (pendingCaret === null) return;
    const el = textareaRef.current;
    el?.focus();
    el?.setSelectionRange(pendingCaret, pendingCaret);
  }, [pendingCaret]);

  const pick = (row: PickerRow) => {
    if (row.section === "Prompts") {
      // A starter prompt replaces the whole input — it IS the message.
      onChange(row.label);
      setCaret(row.label.length);
      setPendingCaret(row.label.length);
    } else if (mentionToken) {
      // Quoted so multi-word titles read unambiguously, to the model too.
      const reference = `@"${row.label}" `;
      const next =
        value.slice(0, mentionToken.start) + reference + value.slice(caret);
      const position = mentionToken.start + reference.length;
      onChange(next);
      setCaret(position);
      setPendingCaret(position);
    }
    setDismissedKey(null);
  };

  const canSend = value.trim().length > 0 && !busy && !disabled;

  const grouped: {
    section: PickerRow["section"];
    rows: { row: PickerRow; index: number }[];
  }[] = [];
  rows.forEach((row, index) => {
    const last = grouped[grouped.length - 1];
    if (last && last.section === row.section) {
      last.rows.push({ row, index });
    } else {
      grouped.push({ section: row.section, rows: [{ row, index }] });
    }
  });

  return (
    <form
      className={cn(
        "relative rounded-card bg-card shadow-composer transition-shadow focus-within:shadow-composer-focus",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      {open && (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-card bg-popover p-1 shadow-overlay">
          <div
            id={menuId}
            role="listbox"
            aria-label={menu === "slash" ? "Starter prompts" : "Insert a reference"}
            className="max-h-64 overflow-y-auto"
          >
            {loading && rows.length === 0 ? (
              <div className="flex h-8 items-center px-2 text-sm text-muted-foreground">
                Loading documents…
              </div>
            ) : (
              grouped.map(({ section, rows: sectionRows }) => (
                <div key={section}>
                  <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                    {section}
                  </div>
                  {sectionRows.map(({ row, index }) => (
                    <button
                      key={row.id}
                      id={`${menuId}-opt-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      tabIndex={-1}
                      // preventDefault keeps focus (and the caret) in the
                      // textarea so the insert lands where the @ was typed.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => pick(row)}
                      className={cn(
                        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent",
                        index === active && "bg-accent",
                      )}
                    >
                      {row.section === "Documents" ? (
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : row.section === "Projects" ? (
                        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          const position = e.target.selectionStart ?? next.length;
          onChange(next);
          setCaret(position);
          setPendingCaret(null);
          // A dismissal outlives Esc only as long as its token does — once
          // the token is deleted, a fresh `@` or `/` opens the menu again.
          if (dismissedKey !== null) {
            const nextSlash = next.startsWith("/") && !next.includes("\n");
            const nextToken = nextSlash
              ? null
              : parseMentionToken(next, position);
            const nextKey = nextSlash
              ? "slash"
              : nextToken
                ? `at:${nextToken.start}`
                : null;
            if (nextKey !== dismissedKey) setDismissedKey(null);
          }
        }}
        onSelect={(e) => {
          setCaret(e.currentTarget.selectionStart ?? 0);
        }}
        onKeyDown={(e) => {
          if (open && e.key === "Escape") {
            e.preventDefault();
            setDismissedKey(menuKey);
            return;
          }
          if (open && rows.length > 0) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive(
                (active + (e.key === "ArrowDown" ? 1 : rows.length - 1)) %
                  rows.length,
              );
              return;
            }
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
              e.preventDefault();
              pick(rows[active] ?? rows[0]!);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        rows={1}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message the assistant"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={
          open && rows.length > 0 ? `${menuId}-opt-${active}` : undefined
        }
        aria-autocomplete="list"
        className={cn(
          "block max-h-80 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-6",
          "placeholder:text-faint-foreground focus-visible:outline-none disabled:opacity-60",
          size === "hero" && "min-h-22",
        )}
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{trailing}</div>
        {busy && onStop ? (
          <Button
            type="button"
            size="icon-sm"
            variant="secondary"
            onClick={onStop}
            aria-label="Stop generating"
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            disabled={!canSend}
            aria-label="Send message"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
