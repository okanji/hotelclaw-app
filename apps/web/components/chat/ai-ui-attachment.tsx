"use client";

import { Children, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import {
  chatUiCatalog,
  validateChatUiSpec,
  type AiUiAttachmentPayload,
  type ChatUiTone,
} from "@/lib/ai/chat-ui/catalog";
import { Badge } from "@/components/ui/badge";
import { Stat, StatGroup } from "@/components/ui/stat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Renders the bot's `ai_ui` attachment — a json-render spec over the
 * chat-UI catalog (`lib/ai/chat-ui/catalog.ts`), drawn with house
 * primitives. Display-only: no state, no actions.
 *
 * The spec is re-validated before rendering so an old message written
 * under a future catalog revision degrades to nothing (the bot's text
 * lead-in still reads fine) instead of crashing the message list.
 */

const TONE_VARIANT: Record<ChatUiTone, "secondary" | "success" | "warning" | "info" | "destructive"> = {
  neutral: "secondary",
  success: "success",
  warning: "warning",
  info: "info",
  destructive: "destructive",
};

const { registry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack: ({ children }) => (
      <div className="flex w-full flex-col gap-3">{children}</div>
    ),
    DataTable: ({ props }) => {
      const router = useRouter();
      return (
        // A rendered table is a distinct embedded object in the message
        // stream, so the card framing is warranted — kept light: soft radius,
        // opacity-based border, no shadow (house separation ladder).
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
          {props.title ? (
            <div className="flex items-baseline justify-between gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                {props.title}
              </span>
              {props.rows.length > 1 ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {props.rows.length}
                </span>
              ) : null}
            </div>
          ) : null}
          {/* Base Table already provides the w-full overflow-x-auto container. */}
          <Table>
            <TableHeader>
              {/* Lighter divider than the base border-b (opacity-based). */}
              <TableRow className="border-border/50 hover:bg-transparent">
                {props.columns.map((c, i) => (
                  <TableHead
                    key={i}
                    className="h-9 px-4 text-xs font-medium text-muted-foreground"
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.rows.map((row, ri) => {
                const href = props.rowHrefs?.[ri] ?? null;
                return (
                  <TableRow
                    key={ri}
                    className={cn(
                      "group border-border/50",
                      // Hover highlight only when the row navigates (base
                      // TableRow hovers unconditionally — suppress it otherwise).
                      href ? "cursor-pointer hover:bg-muted/50" : "hover:bg-transparent",
                    )}
                    onClick={href ? () => router.push(href) : undefined}
                  >
                    {props.columns.map((_, ci) => (
                      <TableCell
                        key={ci}
                        className={cn(
                          "px-4 py-2.5",
                          // First column = the row's label (proportional
                          // figures); trailing columns are metadata/numbers
                          // and get muted + tabular-nums.
                          ci === 0
                            ? "font-medium text-foreground"
                            : "text-muted-foreground tabular-nums",
                        )}
                      >
                        {href && ci === 0 ? (
                          // A real anchor on the first cell keeps the row
                          // keyboard-focusable / cmd-clickable; the row
                          // onClick covers the rest of the surface. No link
                          // color — the row hover + underline is the
                          // affordance (house style, not a blue web link).
                          <Link
                            href={href}
                            className="text-foreground underline-offset-2 group-hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row[ci] ?? ""}
                          </Link>
                        ) : (
                          (row[ci] ?? "")
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      );
    },
    CardGrid: ({ children }) => (
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    ),
    Card: ({ props }) => {
      const body = (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{props.title}</div>
              {props.subtitle ? (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {props.subtitle}
                </div>
              ) : null}
            </div>
            {props.badge ? (
              <Badge variant={TONE_VARIANT[props.badge.tone ?? "neutral"]}>
                {props.badge.label}
              </Badge>
            ) : null}
          </div>
          {props.fields && props.fields.length > 0 ? (
            <dl className="mt-2 space-y-1">
              {props.fields.map((f, i) => (
                <div key={i} className="flex justify-between gap-3 text-xs">
                  <dt className="shrink-0 text-muted-foreground">{f.label}</dt>
                  <dd className="truncate text-right tabular-nums">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      );
      return props.href ? (
        <Link
          href={props.href}
          className="block rounded-xl border border-border/70 bg-card p-3.5 transition-colors hover:border-border hover:bg-muted/40"
        >
          {body}
        </Link>
      ) : (
        <div className="rounded-xl border border-border/70 bg-card p-3.5">
          {body}
        </div>
      );
    },
    StatRow: ({ children }) => {
      const count = Children.count(children);
      const cols = count <= 2 ? 2 : count === 3 ? 3 : 4;
      return (
        <StatGroup cols={cols} className="rounded-xl border border-border/70 bg-card p-3.5">
          {children}
        </StatGroup>
      );
    },
    Stat: ({ props }) => (
      <Stat label={props.label} value={props.value} delta={props.hint} />
    ),
  },
});

export function AiUiAttachment({
  attachment,
}: {
  attachment: AiUiAttachmentPayload;
}) {
  const validated = useMemo(
    () => validateChatUiSpec(attachment.spec),
    [attachment.spec],
  );
  if (!validated.ok) return null;
  return (
    // max-w-4xl (not 2xl): DataTable cells are whitespace-nowrap, so a
    // multi-column table's natural width easily tops 672px and the Status
    // column gets clipped by the table's overflow-x-auto. 896px clears the
    // common cases while staying a readable measure for text-y cards; wider
    // tables still fall back to horizontal scroll.
    <div className="ai-ui-attachment my-1.5 w-full max-w-4xl">
      {/* Renderer's element wrapper calls the state/visibility hooks even
          for static specs, so the provider stack is required. Display-only:
          no handlers, empty initial state. */}
      <JSONUIProvider registry={registry}>
        <Renderer spec={validated.spec} registry={registry} />
      </JSONUIProvider>
    </div>
  );
}
