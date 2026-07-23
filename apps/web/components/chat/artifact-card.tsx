"use client";

import Link from "next/link";
import { FileText, Loader2, ExternalLink, PanelRight } from "lucide-react";
import type { AppArtifactAttachment } from "@hotelclaw/chat-ui";
import { Button } from "@/components/ui/button";
import { useArtifactPanel } from "./artifact-panel-context";

/**
 * Artifact card for `app_artifact` Stream attachments — "the AI is working
 * on this record". Appears the moment a write STARTS (status "writing",
 * pulsing) and upserts to "done" when it lands. "Watch live" opens the
 * split-screen panel (artifact-side-panel.tsx) on the doc's collaborative
 * room, so the write streams in visibly.
 */
export function ArtifactCard({ attachment }: { attachment: AppArtifactAttachment }) {
  const { openDocument } = useArtifactPanel();
  const writing = attachment.status === "writing";
  const canOpen = typeof attachment.document_id === "string";

  return (
    <div className="my-1 flex w-fit max-w-md items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        {writing ? (
          <Loader2 data-slot="icon" className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <FileText data-slot="icon" className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{attachment.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {writing
            ? attachment.action === "appending"
              ? "AI is adding sections…"
              : "AI is writing…"
            : attachment.action === "created"
              ? "Document created"
              : "Document updated"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canOpen ? (
          <Button
            size="sm"
            variant={writing ? "default" : "outline"}
            onClick={() =>
              openDocument(attachment.document_id as string, attachment.title)
            }
          >
            <PanelRight data-slot="icon" />
            {writing ? "Watch live" : "Open"}
          </Button>
        ) : null}
        {attachment.href ? (
          <Link
            href={attachment.href}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Open full page"
          >
            <ExternalLink className="size-4" />
            <span className="sr-only">Open full page</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
