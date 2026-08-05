"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Table — Notion's DATABASE table, measured (notion-spec-v2 §6).
 *
 * **v2 reverses v1's "no vertical rules" reading.** Notion's table view draws
 * BOTH a `border-bottom` and a `border-right` on every cell, at the same 1px
 * warm `--border` ring. What it does *not* have is an outer frame or zebra
 * striping — so the last column drops its right edge and the grid simply ends.
 *
 * The measured metrics baked in here:
 *   - body row **37px**, cell padding **7.5px 8px**
 *   - header row **36px**, labels **14px / 16.8px weight 400 tertiary**
 *     (`text-muted-foreground`) — v1 wrongly styled these 12px faint, which is
 *     the metadata rung, not the UI rung
 *   - the name/title column is `14px weight 500` primary ink →
 *     `<TableCell variant="name">`
 *   - row hover is the warm 5% fill, nothing else (no border shift, no lift)
 *
 * A table is a DATA VIEW, so it breaks OUT of the 720px document column to
 * full width (notion-spec-v2 §3) — don't wrap one in `max-w-content`.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t font-medium [&>tr]:last:border-b-0 [&>tr]:hover:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "h-[37px] border-b transition-colors hover:bg-accent has-aria-expanded:bg-accent data-[state=selected]:bg-accent-pressed",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      // 36px, 14px/16.8px weight 400 tertiary. The right edge is part of the
      // grid; the last column drops it so the table has no outer frame.
      className={cn(
        "h-9 border-r px-2 text-left align-middle text-sm leading-[1.2] font-normal whitespace-nowrap text-muted-foreground last:border-r-0 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"td"> & {
  /**
   * `name` is Notion's title column: 14px **weight 500 primary ink**, the one
   * cell in the row that is not secondary. Every other cell stays `default`.
   */
  variant?: "default" | "name"
}) {
  return (
    <td
      data-slot="table-cell"
      data-variant={variant}
      // Cell padding is the measured 7.5px 8px; the right rule is the same 1px
      // warm ring as the row's bottom rule, dropped on the last column.
      className={cn(
        "border-r px-2 py-[7.5px] align-middle whitespace-nowrap last:border-r-0 [&:has([role=checkbox])]:pr-0",
        variant === "name" && "font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-faint-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
