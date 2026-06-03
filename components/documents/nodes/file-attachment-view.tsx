"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Download, File, FileText, FileSpreadsheet, FileAudio, FileVideo, FileArchive } from "lucide-react";
import { cn } from "@/lib/utils";

function formatBytes(n: number): string {
  if (!n || n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function iconFor(mime: string) {
  if (mime === "application/pdf") return FileText;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.includes("sheet") || mime === "text/csv") return FileSpreadsheet;
  if (mime.includes("zip")) return FileArchive;
  if (mime.startsWith("text/")) return FileText;
  return File;
}

export function FileAttachmentView({ node }: NodeViewProps) {
  const url = (node.attrs.url as string) ?? "";
  const name = (node.attrs.name as string) || "Attachment";
  const size = Number(node.attrs.size ?? 0);
  const mime = (node.attrs.mimeType as string) ?? "";
  const isPdf = mime === "application/pdf";
  const Icon = iconFor(mime);

  return (
    <NodeViewWrapper
      data-type="file-attachment"
      className="file-attachment my-2"
    >
      <div
        contentEditable={false}
        className={cn(
          "flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <Icon className="size-5 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {name}
            </div>
            <div className="text-[12px] text-muted-foreground">
              {mime || "Unknown"} · {formatBytes(size)}
            </div>
          </div>
          {url ? (
            <a
              href={url}
              download={name}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
            >
              <Download className="size-3.5" />
              Download
            </a>
          ) : null}
        </div>
        {isPdf && url ? (
          <embed
            src={url}
            type="application/pdf"
            className="h-96 w-full rounded-md border border-border bg-background"
          />
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
