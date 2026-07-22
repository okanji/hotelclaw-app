"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * H1 — import an external recorder's transcript (.txt/.vtt/.md or pasted
 * text). Runs the native meeting pipeline server-side: AI summary + action
 * items + transcript document; the meeting appears in the list like any
 * recorded one.
 */
export function ImportTranscriptDialog({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  function readFile(file: File) {
    if (file.size > 1024 * 1024) {
      toast.error("That file is too large (1 MB max)");
      return;
    }
    void file.text().then((raw) => {
      // Strip WebVTT chrome (header, cue timestamps, indices) if present.
      const cleaned = raw
        .replace(/^WEBVTT.*$/m, "")
        .replace(/^\d+$/gm, "")
        .replace(
          /^[\d:.]+\s+-->\s+[\d:.]+.*$/gm,
          "",
        )
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      setText(cleaned);
      if (!title) {
        setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 200));
      }
    });
  }

  async function submit() {
    if (!title.trim() || text.trim().length < 40 || busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/meetings/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), text }),
        },
      );
      const data = (await res.json()) as { meetingId?: string; error?: string };
      if (!res.ok || !data.meetingId) {
        throw new Error(data.error ?? "Import failed");
      }
      toast.success("Transcript imported — summary is ready");
      setOpen(false);
      setTitle("");
      setText("");
      router.push(`/p/${propertyId}/meetings/${data.meetingId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <FileUp className="size-4" />
        Import transcript
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import a transcript</DialogTitle>
            <DialogDescription>
              From a recorder or another tool — you get the same summary,
              action items, and transcript document as a recorded meeting.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Meeting title"
              maxLength={200}
              disabled={busy}
            />
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground">
              <Upload className="size-4" />
              Pick a .txt / .vtt / .md file — or paste below
              <input
                type="file"
                accept=".txt,.vtt,.md,.srt"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) readFile(file);
                }}
              />
            </label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Speaker 1: Morning everyone…\nSpeaker 2: Let's start with…"}
              rows={8}
              disabled={busy}
              className="text-sm"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !title.trim() || text.trim().length < 40}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Summarizing…
                </>
              ) : (
                "Import & summarize"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
