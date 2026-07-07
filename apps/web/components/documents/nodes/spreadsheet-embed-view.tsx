"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Table2 } from "lucide-react";

export function SpreadsheetEmbedView({ node }: NodeViewProps) {
  const url = (node.attrs.url as string) ?? "";
  const provider = (node.attrs.provider as string) ?? "google-sheets";

  if (!url) {
    return (
      <NodeViewWrapper
        data-type="spreadsheet-embed"
        className="my-2 flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground"
      >
        <Table2 className="size-4" />
        Spreadsheet embed (no URL)
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper data-type="spreadsheet-embed" className="my-2">
      <div
        contentEditable={false}
        className="overflow-hidden rounded-lg border border-border bg-muted/20"
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Table2 className="size-3.5" />
            {provider === "excel-online" ? "Excel Online" : "Google Sheets"}
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Open ↗
          </a>
        </div>
        <iframe
          src={url}
          className="h-96 w-full"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          referrerPolicy="no-referrer"
        />
      </div>
    </NodeViewWrapper>
  );
}
