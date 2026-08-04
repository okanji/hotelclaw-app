"use client";

/**
 * Notion-style document header: optional cover image, optional emoji icon,
 * and a hover row of "Add icon / Add cover / Add comment" buttons that lets
 * users add what's missing. Sits above the in-editor title (the `<h1>` first
 * node) inside the same centered max-w-3xl column.
 *
 * State:
 *   - `documents.icon` (text) and `documents.cover_url` (text) — see
 *     migration 0037. Read+write via the browser supabase-js client.
 *   - "Add comment" doesn't write any state — it asks the parent (the
 *     editor) to set a selection on the title and open Liveblocks's
 *     pending-comment composer. The actual thread is created when the user
 *     submits via the floating composer.
 */

import dynamic from "next/dynamic";
import data from "@emoji-mart/data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ImageIcon,
  MessageCircle,
  Smile,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

const EmojiPicker = dynamic(
  () => import("@emoji-mart/react").then((m) => m.default),
  { ssr: false, loading: () => null },
);

type DocMeta = { icon: string | null; cover_url: string | null };

const META_QUERY_KEY = (id: string) => ["doc-meta", id] as const;

export function DocumentHeader({
  propertyId,
  documentId,
  onAddComment,
}: {
  propertyId: string;
  documentId: string;
  /** Triggered when the user clicks "Add comment" — the editor selects the
   *  title and opens Liveblocks's pending-comment composer. */
  onAddComment: () => void;
}) {
  const supabase = createBrowserClient();
  const qc = useQueryClient();

  const { data: meta } = useQuery({
    queryKey: META_QUERY_KEY(documentId),
    queryFn: async (): Promise<DocMeta> => {
      const { data, error } = await supabase
        .from("documents")
        .select("icon, cover_url")
        .eq("id", documentId)
        .maybeSingle();
      if (error) throw error;
      return {
        icon: (data?.icon as string | null) ?? null,
        cover_url: (data?.cover_url as string | null) ?? null,
      };
    },
  });

  async function setIcon(emoji: string | null) {
    qc.setQueryData<DocMeta>(META_QUERY_KEY(documentId), (old) => ({
      icon: emoji,
      cover_url: old?.cover_url ?? null,
    }));
    const { error } = await supabase
      .from("documents")
      .update({ icon: emoji })
      .eq("id", documentId);
    if (error) {
      toast.error("Couldn't save icon");
      // Roll back the optimistic update
      void qc.invalidateQueries({ queryKey: META_QUERY_KEY(documentId) });
    }
  }

  async function setCover(url: string | null) {
    qc.setQueryData<DocMeta>(META_QUERY_KEY(documentId), (old) => ({
      icon: old?.icon ?? null,
      cover_url: url,
    }));
    const { error } = await supabase
      .from("documents")
      .update({ cover_url: url })
      .eq("id", documentId);
    if (error) {
      toast.error("Couldn't save cover");
      void qc.invalidateQueries({ queryKey: META_QUERY_KEY(documentId) });
    }
  }

  async function pickAndUploadCover() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch(
          `/api/documents/images/upload?propertyId=${propertyId}&documentId=${documentId}`,
          { method: "POST", body: form },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const { url } = (await res.json()) as { url: string };
        await setCover(url);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      }
    });
    input.click();
  }

  const icon = meta?.icon ?? null;
  const cover = meta?.cover_url ?? null;

  return (
    <div className="document-header group/header">
      {/* Cover image — full-width strip, with hover replace/remove controls. */}
      {cover ? (
        <div className="group/cover relative -mx-6 mb-3 h-44 overflow-hidden md:-mx-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cover}
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute bottom-3 right-3 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100">
            <button
              type="button"
              onClick={pickAndUploadCover}
              className="h-7 rounded-md bg-popover px-2 text-xs font-medium text-foreground shadow-overlay transition-colors hover:bg-accent"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => setCover(null)}
              className="rounded-md bg-popover p-1.5 text-foreground shadow-overlay transition-colors hover:bg-accent"
              aria-label="Remove cover"
              title="Remove cover"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Emoji icon, if set. Click to change. */}
      {icon ? (
        <div className="mb-1">
          <IconPicker
            current={icon}
            onSelect={(emoji) => void setIcon(emoji)}
            trigger={
              <button
                type="button"
                className="select-none text-5xl leading-none transition-opacity hover:opacity-80"
                aria-label="Change icon"
              >
                {icon}
              </button>
            }
          />
        </div>
      ) : null}

      {/* Hover hint row — "Add icon / Add cover / Add comment". Only the
          buttons whose target isn't already set are shown. */}
      <div className="mb-2 -ml-1.5 flex h-7 items-center gap-0.5 text-sm text-faint-foreground opacity-0 transition-opacity group-hover/header:opacity-100">
        {!icon ? (
          <IconPicker
            onSelect={(emoji) => void setIcon(emoji)}
            trigger={
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-accent"
              >
                <Smile className="size-4" />
                Add icon
              </button>
            }
          />
        ) : null}
        {!cover ? (
          <button
            type="button"
            onClick={pickAndUploadCover}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-accent"
          >
            <ImageIcon className="size-4" />
            Add cover
          </button>
        ) : null}
        <button
          type="button"
          onClick={onAddComment}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-accent"
        >
          <MessageCircle className="size-4" />
          Add comment
        </button>
      </div>
    </div>
  );
}

/** Popover wrapping the emoji-mart picker. The picker is dynamic-imported so
 *  its emoji data doesn't bloat the initial editor bundle. */
function IconPicker({
  current,
  onSelect,
  trigger,
}: {
  current?: string;
  onSelect: (emoji: string) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={() => trigger as React.ReactElement} />
      <PopoverContent align="start" sideOffset={6} className="!w-auto !p-0">
        <EmojiPicker
          data={data}
          previewPosition="none"
          skinTonePosition="none"
          onEmojiSelect={(e: { native?: string }) => {
            if (e.native) {
              onSelect(e.native);
              setOpen(false);
            }
          }}
          // Match the editor's current theme — emoji-mart auto-detects.
        />
        {current ? (
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => {
                onSelect("");
                setOpen(false);
              }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Remove icon
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
