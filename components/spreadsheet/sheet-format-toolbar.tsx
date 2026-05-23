"use client";

/**
 * Cell-format toolbar: bold, italic, underline, strike, alignment, text /
 * background color, number format, decimals.
 *
 * Reads the active cell's current format so toggle buttons reflect state.
 * Writes via `useSetCellFormat` from `lib/spreadsheet/mutations` against the
 * full current selection rectangle, so a single click applies the change to
 * every selected cell.
 */

import { useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  DollarSign,
  Grid3x3,
  Italic,
  Link as LinkIcon,
  Merge,
  Paintbrush,
  Percent,
  Split,
  Square,
  Strikethrough,
  Underline,
  WrapText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  CellAlign,
  CellBorder,
  CellFormat,
  CellNumberFormat,
  CellWrap,
} from "@/liveblocks.config";

export type FormatPatch = Partial<CellFormat>;

/**
 * Border preset semantics:
 *  - `all`    every cell gets the border on every edge
 *  - `outer`  only the outer perimeter of the selection (top row's top
 *             edge, bottom row's bottom edge, left col's left edge, etc.)
 *  - `inner`  internal edges only (between selected cells)
 *  - `top|bottom|left|right` — only the perimeter edge of that side
 *  - `none`   strip all 4 edges from every selected cell
 *
 * The surface receives the preset + border and walks the selection bounds
 * to apply per-cell edge patches.
 */
export type BorderPreset =
  | "all"
  | "outer"
  | "inner"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "none";

export const SHEET_FONTS: ReadonlyArray<{ id: string; label: string; stack: string }> = [
  { id: "inter", label: "Inter", stack: "Inter, ui-sans-serif, system-ui, sans-serif" },
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "times", label: "Times", stack: "'Times New Roman', Times, serif" },
  { id: "courier", label: "Courier", stack: "'Courier New', Courier, monospace" },
  { id: "mono", label: "Monospace", stack: "ui-monospace, SFMono-Regular, monospace" },
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 32, 48] as const;

const TEXT_COLORS = [
  "#0f172a", // default
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];
const BG_COLORS = [
  "transparent",
  "#fef3c7",
  "#fee2e2",
  "#dbeafe",
  "#dcfce7",
  "#ede9fe",
  "#fce7f3",
  "#e0f2fe",
  "#f1f5f9",
];

export function SheetFormatToolbar({
  activeFormat,
  hasSelection,
  onPatch,
  painterActive,
  onTogglePainter,
  onApplyBorders,
  onMerge,
  onUnmerge,
  canMerge,
  canUnmerge,
}: {
  activeFormat: CellFormat | null;
  hasSelection: boolean;
  onPatch: (patch: FormatPatch) => void;
  /** True while the format-painter has a captured format waiting to apply. */
  painterActive?: boolean;
  /** Capture the active cell's format (or cancel an in-flight capture). */
  onTogglePainter?: () => void;
  /** Apply a borders preset to the current selection. */
  onApplyBorders?: (preset: BorderPreset, border: CellBorder | null) => void;
  /** Merge the current selection rectangle into one cell. */
  onMerge?: () => void;
  /** Unmerge the merge whose top-left equals the selection's top-left. */
  onUnmerge?: () => void;
  canMerge?: boolean;
  canUnmerge?: boolean;
}) {
  const disabled = !hasSelection;

  const fmt = activeFormat ?? {};

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/60 bg-background/60 px-3 py-1.5">
      <ToggleButton
        title={
          painterActive
            ? "Cancel format painter (Esc)"
            : "Format painter — click to capture, then click a target cell"
        }
        active={painterActive}
        disabled={disabled && !painterActive}
        onClick={() => onTogglePainter?.()}
      >
        <Paintbrush className="size-4" />
      </ToggleButton>

      <Separator />

      <ToggleButton
        title="Bold (Cmd+B)"
        active={!!fmt.bold}
        disabled={disabled}
        onClick={() => onPatch({ bold: !fmt.bold ? true : undefined })}
      >
        <Bold className="size-4" />
      </ToggleButton>
      <ToggleButton
        title="Italic (Cmd+I)"
        active={!!fmt.italic}
        disabled={disabled}
        onClick={() => onPatch({ italic: !fmt.italic ? true : undefined })}
      >
        <Italic className="size-4" />
      </ToggleButton>
      <ToggleButton
        title="Underline (Cmd+U)"
        active={!!fmt.underline}
        disabled={disabled}
        onClick={() =>
          onPatch({ underline: !fmt.underline ? true : undefined })
        }
      >
        <Underline className="size-4" />
      </ToggleButton>
      <ToggleButton
        title="Strikethrough"
        active={!!fmt.strike}
        disabled={disabled}
        onClick={() => onPatch({ strike: !fmt.strike ? true : undefined })}
      >
        <Strikethrough className="size-4" />
      </ToggleButton>

      <Separator />

      <FontFamilyButton
        current={fmt.fontFamily}
        disabled={disabled}
        onPatch={onPatch}
      />
      <FontSizeButton
        current={fmt.fontSize}
        disabled={disabled}
        onPatch={onPatch}
      />

      <Separator />

      <AlignButton current={fmt.align} disabled={disabled} onPatch={onPatch} />

      <Separator />

      <BordersButton
        disabled={disabled}
        onApply={(preset, border) => onApplyBorders?.(preset, border)}
      />
      <WrapButton
        current={fmt.wrap}
        disabled={disabled}
        onPatch={onPatch}
      />
      <ToggleButton
        title="Merge cells"
        active={false}
        disabled={!canMerge}
        onClick={() => onMerge?.()}
      >
        <Merge className="size-4" />
      </ToggleButton>
      <ToggleButton
        title="Unmerge"
        active={false}
        disabled={!canUnmerge}
        onClick={() => onUnmerge?.()}
      >
        <Split className="size-4" />
      </ToggleButton>
      <ToggleButton
        title={
          fmt.link
            ? `Remove link (${fmt.link})`
            : "Insert link (Cmd+K)"
        }
        active={!!fmt.link}
        disabled={disabled}
        onClick={() => {
          if (fmt.link) {
            onPatch({ link: undefined });
            return;
          }
          // eslint-disable-next-line no-alert
          const url = window.prompt("Link URL:", "https://");
          if (url) onPatch({ link: url });
        }}
      >
        <LinkIcon className="size-4" />
      </ToggleButton>

      <Separator />

      <ColorButton
        kind="text"
        current={fmt.textColor}
        disabled={disabled}
        onPatch={onPatch}
      />
      <ColorButton
        kind="bg"
        current={fmt.bgColor}
        disabled={disabled}
        onPatch={onPatch}
      />

      <Separator />

      <NumberFormatButton
        current={fmt.numberFormat}
        decimals={fmt.decimals}
        disabled={disabled}
        onPatch={onPatch}
      />
      <ToggleButton
        title="Format as currency"
        active={fmt.numberFormat === "currency"}
        disabled={disabled}
        onClick={() =>
          onPatch({
            numberFormat:
              fmt.numberFormat === "currency" ? undefined : "currency",
          })
        }
      >
        <DollarSign className="size-4" />
      </ToggleButton>
      <ToggleButton
        title="Format as percent"
        active={fmt.numberFormat === "percent"}
        disabled={disabled}
        onClick={() =>
          onPatch({
            numberFormat:
              fmt.numberFormat === "percent" ? undefined : "percent",
          })
        }
      >
        <Percent className="size-4" />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  children,
  active,
  disabled,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn("size-7", active && "bg-muted text-foreground")}
    >
      {children}
    </Button>
  );
}

function Separator() {
  return <span className="mx-1 h-5 w-px self-center bg-border/80" />;
}

const BORDER_STYLES: ReadonlyArray<{ id: CellBorder["style"]; label: string }> = [
  { id: "thin", label: "Thin" },
  { id: "medium", label: "Medium" },
  { id: "thick", label: "Thick" },
  { id: "dashed", label: "Dashed" },
  { id: "dotted", label: "Dotted" },
  { id: "double", label: "Double" },
];

const BORDER_COLORS = [
  "#94a3b8", // default neutral
  "#0f172a",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
];

function BordersButton({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (preset: BorderPreset, border: CellBorder | null) => void;
}) {
  // Local style + color choices propagate to every preset clicked. State
  // lives outside the menu so picks persist across menu opens during a
  // session (matches Excel — "border style stays until you change it").
  const [style, setStyle] = useState<CellBorder["style"]>("thin");
  const [color, setColor] = useState<string>("#94a3b8");
  const border: CellBorder = { style, color };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled}
            title="Borders"
            className="size-7"
          >
            <Grid3x3 className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Borders</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem onClick={() => onApply("all", border)}>
          <Grid3x3 className="size-4" /> All borders
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onApply("outer", border)}>
          <Square className="size-4" /> Outer border
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onApply("inner", border)}>
          Inner borders
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onApply("top", border)}>
          Top border
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onApply("bottom", border)}>
          Bottom border
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onApply("left", border)}>
          Left border
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onApply("right", border)}>
          Right border
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onApply("none", null)}>
          No borders
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Style</DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="grid grid-cols-3 gap-1 px-2 pb-1.5">
          {BORDER_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setStyle(s.id);
              }}
              className={cn(
                "rounded border border-border/60 px-1.5 py-1 text-[11px] hover:bg-muted",
                style === s.id && "bg-muted text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Color</DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="grid grid-cols-9 gap-1 px-2 pb-1.5">
          {BORDER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setColor(c);
              }}
              title={c}
              className={cn(
                "size-5 rounded-sm border border-border/60 hover:ring-2 hover:ring-foreground/15",
                color === c && "ring-2 ring-foreground/40",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WrapButton({
  current,
  disabled,
  onPatch,
}: {
  current?: CellWrap;
  disabled: boolean;
  onPatch: (p: FormatPatch) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled}
            title="Text wrap"
            className={cn("size-7", current && current !== "overflow" && "bg-muted text-foreground")}
          >
            <WrapText className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        <DropdownMenuItem
          onClick={() => onPatch({ wrap: "overflow" })}
          className={cn((current ?? "overflow") === "overflow" && "bg-muted")}
        >
          Overflow
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onPatch({ wrap: "wrap" })}
          className={cn(current === "wrap" && "bg-muted")}
        >
          Wrap
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onPatch({ wrap: "clip" })}
          className={cn(current === "clip" && "bg-muted")}
        >
          Clip
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FontFamilyButton({
  current,
  disabled,
  onPatch,
}: {
  current?: string;
  disabled: boolean;
  onPatch: (p: FormatPatch) => void;
}) {
  const active = SHEET_FONTS.find((f) => f.stack === current) ?? SHEET_FONTS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            title="Font"
            className="h-7 min-w-[88px] justify-start gap-1 px-2 text-[12px]"
          >
            <span style={{ fontFamily: active?.stack }}>{active?.label}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        {SHEET_FONTS.map((f) => (
          <DropdownMenuItem
            key={f.id}
            onClick={() => onPatch({ fontFamily: f.stack })}
            className={cn(active?.id === f.id && "bg-muted")}
          >
            <span style={{ fontFamily: f.stack }}>{f.label}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPatch({ fontFamily: undefined })}>
          Reset
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FontSizeButton({
  current,
  disabled,
  onPatch,
}: {
  current?: number;
  disabled: boolean;
  onPatch: (p: FormatPatch) => void;
}) {
  const value = current ?? 14;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            title="Font size"
            className="h-7 min-w-[44px] px-2 text-[12px] tabular-nums"
          >
            {value}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        {FONT_SIZES.map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => onPatch({ fontSize: s })}
            className={cn(value === s && "bg-muted")}
          >
            {s}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPatch({ fontSize: undefined })}>
          Reset
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AlignButton({
  current,
  disabled,
  onPatch,
}: {
  current?: CellAlign;
  disabled: boolean;
  onPatch: (p: FormatPatch) => void;
}) {
  const Icon =
    current === "right"
      ? AlignRight
      : current === "center"
        ? AlignCenter
        : AlignLeft;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled}
            title="Horizontal align"
            className="size-7"
          >
            <Icon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        {/* Base UI Menu.Item fires onClick, not onSelect. */}
        <DropdownMenuItem onClick={() => onPatch({ align: "left" })}>
          <AlignLeft className="size-4" /> Left
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPatch({ align: "center" })}>
          <AlignCenter className="size-4" /> Center
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPatch({ align: "right" })}>
          <AlignRight className="size-4" /> Right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPatch({ align: undefined })}>
          Reset
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColorButton({
  kind,
  current,
  disabled,
  onPatch,
}: {
  kind: "text" | "bg";
  current?: string;
  disabled: boolean;
  onPatch: (p: FormatPatch) => void;
}) {
  const palette = kind === "text" ? TEXT_COLORS : BG_COLORS;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled}
            title={kind === "text" ? "Text color" : "Background color"}
            className="size-7"
          >
            <span
              className="block size-3.5 rounded-sm border border-border/60"
              style={{
                background:
                  current ??
                  (kind === "text" ? "var(--foreground)" : "transparent"),
              }}
            />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {kind === "text" ? "Text color" : "Background color"}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="grid grid-cols-9 gap-1 p-1">
          {palette.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() =>
                onPatch(
                  kind === "text" ? { textColor: c } : { bgColor: c },
                )
              }
              title={c}
              className={cn(
                "size-5 rounded-sm border border-border/60 transition-shadow hover:ring-2 hover:ring-foreground/15",
                current === c && "ring-2 ring-foreground/40",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            onPatch(
              kind === "text"
                ? { textColor: undefined }
                : { bgColor: undefined },
            )
          }
        >
          Reset
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NumberFormatButton({
  current,
  decimals,
  disabled,
  onPatch,
}: {
  current?: CellNumberFormat;
  decimals?: number;
  disabled: boolean;
  onPatch: (p: FormatPatch) => void;
}) {
  const FORMATS: Array<{ id: CellNumberFormat; label: string }> = [
    { id: "plain", label: "Plain" },
    { id: "number", label: "Number (1,234.56)" },
    { id: "currency", label: "Currency ($1,234.56)" },
    { id: "percent", label: "Percent (12%)" },
    { id: "date", label: "Date" },
    { id: "datetime", label: "Date + time" },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            title="Number format"
            className="h-7 px-2 text-[12px]"
          >
            123
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Number format</DropdownMenuLabel>
          {FORMATS.map((f) => (
            <DropdownMenuItem
              key={f.id}
              onClick={() => onPatch({ numberFormat: f.id })}
              className={cn(current === f.id && "bg-muted")}
            >
              {f.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => {
              // eslint-disable-next-line no-alert
              const s = window.prompt(
                "Custom number format (e.g. $#,##0.00;[Red]-$#,##0.00):",
              );
              if (s == null || s === "") return;
              onPatch({ numberFormat: "custom", customNumberFormat: s });
            }}
            className={cn(current === "custom" && "bg-muted")}
          >
            Custom format…
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Decimals</DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="flex items-center gap-1 px-2 pb-1.5">
          {[0, 1, 2, 3, 4].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onPatch({ decimals: d })}
              className={cn(
                "h-6 w-6 rounded text-[12px] hover:bg-muted",
                decimals === d && "bg-muted text-foreground",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
