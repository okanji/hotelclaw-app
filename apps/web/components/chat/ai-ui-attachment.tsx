"use client";

import { Children, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ExternalLink, PanelRight } from "lucide-react";
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
import { documentsTreeQueryOptions } from "@/lib/query/section-queries";
import { cn } from "@/lib/utils";
import { useOptionalArtifactPanel } from "./artifact-panel-context";

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

/**
 * A document deep link (`/p/<pid>/documents/<id>`) can open in the chat's
 * split-screen artifact panel instead of navigating away — same treatment
 * as ArtifactCard: panel is the primary action, full page the secondary.
 */
const DOC_HREF_RX =
  /^\/p\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/documents\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

function parseDocumentHref(
  href: string | null | undefined,
): { propertyId: string; documentId: string } | null {
  if (!href) return null;
  const m = DOC_HREF_RX.exec(href);
  return m ? { propertyId: m[1], documentId: m[2] } : null;
}

/**
 * Resolves whether a document record is a sheet (mounts SheetEditor in the
 * panel) from the warm documents-tree cache — the same effectively-sync
 * branch documents-surface uses. Cold cache falls back to "document"; the
 * rich-text editor handles its own loading/404.
 */
function useDocumentKind(propertyId: string | null) {
  const { data } = useQuery({
    ...documentsTreeQueryOptions(propertyId ?? ""),
    enabled: propertyId != null,
  });
  return useCallback(
    (documentId: string): "document" | "sheet" =>
      data?.find((d) => d.id === documentId)?.kind === "sheet"
        ? "sheet"
        : "document",
    [data],
  );
}

const { registry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack: ({ children }) => (
      <div className="flex w-full flex-col gap-3">{children}</div>
    ),
    DataTable: ({ props }) => {
      const router = useRouter();
      const panel = useOptionalArtifactPanel();
      const docTargets = useMemo(
        () => (props.rowHrefs ?? []).map((h) => parseDocumentHref(h)),
        [props.rowHrefs],
      );
      const kindOf = useDocumentKind(
        docTargets.find((d) => d != null)?.propertyId ?? null,
      );
      // Trailing affordance column whenever any row is clickable — makes
      // link rows legible at a glance instead of hover-only.
      const hasLinks = (props.rowHrefs ?? []).some((h) => h != null);
      return (
        // A rendered table is a distinct embedded object in the message
        // stream, so the card framing is warranted — kept light: soft radius,
        // opacity-based border, no shadow (house separation ladder).
        <div className="overflow-hidden rounded-md bg-background">
          {props.title ? (
            <div className="flex items-baseline justify-between gap-3 border-b border-border bg-muted px-4 py-2.5">
              <span className="text-sm font-medium text-foreground">
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
              <TableRow className="border-border hover:bg-transparent">
                {props.columns.map((c, i) => (
                  <TableHead
                    key={i}
                    className="h-9 px-4 text-xs font-medium text-muted-foreground"
                  >
                    {c}
                  </TableHead>
                ))}
                {hasLinks ? <TableHead aria-hidden className="h-9 w-10 px-2" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.rows.map((row, ri) => {
                const href = props.rowHrefs?.[ri] ?? null;
                const doc = docTargets[ri] ?? null;
                // Document rows open the split-screen artifact panel (the
                // conversation stays put); everything else navigates.
                const openArtifact =
                  doc && panel
                    ? () =>
                        panel.open({
                          kind: kindOf(doc.documentId),
                          documentId: doc.documentId,
                          title: row[0] || "Document",
                        })
                    : null;
                return (
                  <TableRow
                    key={ri}
                    className={cn(
                      "group border-border",
                      // Hover highlight only when the row acts (base
                      // TableRow hovers unconditionally — suppress it otherwise).
                      href ? "cursor-pointer hover:bg-accent" : "hover:bg-transparent",
                    )}
                    onClick={
                      openArtifact ??
                      (href ? () => router.push(href) : undefined)
                    }
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
                          // For document rows a plain click opens the side
                          // panel instead; modified clicks keep the anchor's
                          // native open-in-new-tab.
                          <Link
                            href={href}
                            className="text-foreground underline-offset-2 group-hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                openArtifact &&
                                !e.metaKey &&
                                !e.ctrlKey &&
                                !e.shiftKey &&
                                !e.altKey
                              ) {
                                e.preventDefault();
                                openArtifact();
                              }
                            }}
                          >
                            {row[ci] ?? ""}
                          </Link>
                        ) : (
                          (row[ci] ?? "")
                        )}
                      </TableCell>
                    ))}
                    {hasLinks ? (
                      <TableCell className="w-10 px-2 py-2.5">
                        {openArtifact && href ? (
                          // Document row: visible split-view affordance +
                          // an explicit full-page escape hatch.
                          <span className="flex items-center justify-end gap-0.5">
                            <span
                              className="flex size-6 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors group-hover:text-foreground"
                              title="Open in side panel"
                            >
                              <PanelRight className="size-3.5" />
                            </span>
                            <Link
                              href={href}
                              onClick={(e) => e.stopPropagation()}
                              title="Open full page"
                              className="flex size-6 items-center justify-center rounded-sm text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <ExternalLink className="size-3.5" />
                              <span className="sr-only">Open full page</span>
                            </Link>
                          </span>
                        ) : href ? (
                          // Plain link row: the arrow says "this navigates".
                          <span className="flex items-center justify-end">
                            <span className="flex size-6 items-center justify-center text-muted-foreground/50 transition-colors group-hover:text-foreground">
                              <ArrowUpRight className="size-3.5" />
                            </span>
                          </span>
                        ) : null}
                      </TableCell>
                    ) : null}
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
      const panel = useOptionalArtifactPanel();
      const doc = useMemo(() => parseDocumentHref(props.href), [props.href]);
      const kindOf = useDocumentKind(doc?.propertyId ?? null);
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
      if (doc && panel && props.href) {
        // Document card: clicking opens the split-screen artifact panel
        // (ArtifactCard pattern); the divided right rail is the explicit
        // full-page action.
        const href = props.href;
        return (
          <div className="group flex items-stretch overflow-hidden rounded-md bg-background">
            <button
              type="button"
              title="Open in side panel"
              className="min-w-0 flex-1 cursor-pointer p-3.5 text-left transition-colors hover:bg-accent focus-visible:bg-muted focus-visible:outline-none"
              onClick={() =>
                panel.open({
                  kind: kindOf(doc.documentId),
                  documentId: doc.documentId,
                  title: props.title || "Document",
                })
              }
            >
              {body}
              <span className="mt-2 flex items-center gap-1 text-xs font-medium text-muted-foreground/60 transition-colors group-hover:text-foreground">
                <PanelRight className="size-3.5" />
                Open in side panel
              </span>
            </button>
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              title="Open full page"
              className="flex shrink-0 items-center border-l border-border px-2.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
            >
              <ExternalLink className="size-4" />
              <span className="sr-only">Open full page</span>
            </Link>
          </div>
        );
      }
      return props.href ? (
        <Link
          href={props.href}
          className="block rounded-md bg-background p-3.5 transition-colors hover:bg-accent"
        >
          {body}
        </Link>
      ) : (
        <div className="rounded-md bg-background p-3.5">
          {body}
        </div>
      );
    },
    StatRow: ({ children }) => {
      const count = Children.count(children);
      const cols = count <= 2 ? 2 : count === 3 ? 3 : 4;
      return (
        <StatGroup cols={cols} className="rounded-md bg-background p-3.5">
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
