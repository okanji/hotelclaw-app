"use client";

import Link from "next/link";
import { FileText, Loader2, ExternalLink, PanelRight, Table2 } from "lucide-react";
import type { AppArtifactAttachment } from "@hotelclaw/chat-ui";
import { cn } from "@/lib/utils";
import { TintIcon } from "@/components/ui/tint-card";
import { useArtifactPanel } from "./artifact-panel-context";

/**
 * Artifact card for `app_artifact` Stream attachments — "the AI is working
 * on this record". Appears the moment a write STARTS (status "writing",
 * pulsing) and upserts to "done" when it lands.
 *
 * The WHOLE card is the click target: it opens the split-screen panel
 * (artifact-side-panel.tsx) on the doc's collaborative room, so a "writing"
 * card streams in visibly and a finished one opens to read. When a full-page
 * href exists too, it rides along as a divided secondary action on the right.
 */
export function ArtifactCard({ attachment }: { attachment: AppArtifactAttachment }) {
  const { open } = useArtifactPanel();
  const writing = attachment.status === "writing";
  const canOpen = typeof attachment.document_id === "string";
  const isSheet = attachment.kind === "sheet";
  const noun = isSheet ? "Spreadsheet" : "Document";

  const status = writing
    ? attachment.action === "appending"
      ? "AI is adding sections…"
      : "AI is writing…"
    : attachment.action === "created"
      ? `${noun} created`
      : `${noun} updated`;

  const plate = writing ? (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
      <Loader2 data-slot="icon" className="size-[1.15rem] animate-spin text-muted-foreground" />
    </span>
  ) : (
    <TintIcon tone={isSheet ? "sage" : "blue"}>
      {isSheet ? <Table2 /> : <FileText />}
    </TintIcon>
  );

  const body = (
    <>
      {plate}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {attachment.title}
        </span>
        <span
          className={cn(
            "block truncate text-xs",
            writing ? "text-primary-ink" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      </span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 text-xs font-medium transition-colors",
          writing
            ? "text-primary-ink"
            : "text-muted-foreground/70 group-hover:text-foreground",
        )}
      >
        <PanelRight data-slot="icon" className="size-3.5" />
        {writing ? "Watch live" : "Open"}
      </span>
    </>
  );

  // Shared surface + hover treatment. Individual regions light up on hover so
  // the card reads as tappable without a heavy button.
  const rowClass =
    "flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-muted";

  // Non-interactive fallback: no panel target and no href.
  if (!canOpen && !attachment.href) {
    return (
      <div className="my-1 flex w-full max-w-md items-center gap-3 rounded-md bg-background px-3 py-2.5">
        {body}
      </div>
    );
  }

  return (
    <div className="group my-1 flex w-full max-w-md items-stretch overflow-hidden rounded-md bg-background transition-colors hover:bg-accent">
      {canOpen ? (
        <button
          type="button"
          className={cn(rowClass, "cursor-pointer")}
          onClick={() =>
            open({
              kind: isSheet ? "sheet" : "document",
              documentId: attachment.document_id as string,
              title: attachment.title,
            })
          }
        >
          {body}
        </button>
      ) : (
        <Link href={attachment.href!} className={rowClass}>
          {body}
        </Link>
      )}

      {canOpen && attachment.href ? (
        <Link
          href={attachment.href}
          onClick={(e) => e.stopPropagation()}
          title="Open full page"
          className="flex shrink-0 items-center border-l border-border px-3 text-muted-foreground/70 transition-colors hover:bg-accent focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
        >
          <ExternalLink className="size-4" />
          <span className="sr-only">Open full page</span>
        </Link>
      ) : null}
    </div>
  );
}
