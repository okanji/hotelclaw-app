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

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  DollarSign,
  Italic,
  Percent,
  Strikethrough,
  Underline,
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
  CellFormat,
  CellNumberFormat,
} from "@/liveblocks.config";

export type FormatPatch = Partial<CellFormat>;

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
}: {
  activeFormat: CellFormat | null;
  hasSelection: boolean;
  onPatch: (patch: FormatPatch) => void;
}) {
  const disabled = !hasSelection;

  const fmt = activeFormat ?? {};

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/60 bg-background/60 px-3 py-1.5">
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

      <AlignButton current={fmt.align} disabled={disabled} onPatch={onPatch} />

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
      <DropdownMenuContent align="start">
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
      <DropdownMenuContent align="start">
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
      <DropdownMenuContent align="start">
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
