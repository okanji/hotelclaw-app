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
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {props.title ? (
            <div className="border-b border-border/60 bg-muted/30 px-3 py-2 text-sm font-medium">
              {props.title}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {props.columns.map((c, i) => (
                    <TableHead
                      key={i}
                      className="text-xs text-muted-foreground"
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
                      className={
                        href ? "cursor-pointer hover:bg-muted/40" : undefined
                      }
                      onClick={href ? () => router.push(href) : undefined}
                    >
                      {props.columns.map((_, ci) => (
                        <TableCell key={ci} className="tabular-nums">
                          {href && ci === 0 ? (
                            // A real anchor on the first cell keeps the row
                            // keyboard-focusable / cmd-clickable; the row
                            // onClick covers the rest of the surface.
                            <Link
                              href={href}
                              className="font-medium hover:underline"
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
          className="block rounded-lg border border-border bg-card p-3 transition-colors hover:border-border hover:bg-muted/40"
        >
          {body}
        </Link>
      ) : (
        <div className="rounded-lg border border-border bg-card p-3">{body}</div>
      );
    },
    StatRow: ({ children }) => {
      const count = Children.count(children);
      const cols = count <= 2 ? 2 : count === 3 ? 3 : 4;
      return (
        <StatGroup cols={cols} className="rounded-lg border border-border bg-card p-3">
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
    <div className="my-1.5 max-w-2xl">
      {/* Renderer's element wrapper calls the state/visibility hooks even
          for static specs, so the provider stack is required. Display-only:
          no handlers, empty initial state. */}
      <JSONUIProvider registry={registry}>
        <Renderer spec={validated.spec} registry={registry} />
      </JSONUIProvider>
    </div>
  );
}
