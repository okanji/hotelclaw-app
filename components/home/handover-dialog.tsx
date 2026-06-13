"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Sparkles } from "lucide-react";
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
import { channelsQueryOptions } from "@/lib/query/section-queries";

/**
 * "Draft my handover" — the AI gathers the shift window's activity
 * deterministically and drafts four sections (Progress / New risks /
 * Blockers / For next shift); the author edits the markdown and publishes
 * it to a channel under their own name. The human sign-off is the point:
 * nothing goes out unedited.
 */
export function HandoverDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [phase, setPhase] = useState<"drafting" | "editing" | "publishing">(
    "drafting",
  );
  const [draft, setDraft] = useState("");
  const [window, setWindow] = useState<{ start: string; end: string } | null>(
    null,
  );
  const [channelId, setChannelId] = useState<string>("");
  const { data: channels = [] } = useQuery({
    ...channelsQueryOptions(propertyId),
    enabled: open,
  });

  // Reset at render time when the dialog opens — not inside the effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPhase("drafting");
      setDraft("");
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/properties/${propertyId}/handover/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
          draft: string;
          window: { start: string; end: string };
        };
        if (cancelled) return;
        setDraft(body.draft);
        setWindow(body.window);
        setPhase("editing");
      } catch (e) {
        if (cancelled) return;
        toast.error(
          e instanceof Error ? e.message : "Couldn't draft the handover",
        );
        onOpenChange(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, propertyId]);

  async function publish() {
    if (!draft.trim()) return;
    setPhase("publishing");
    try {
      const res = await fetch(`/api/properties/${propertyId}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bodyMd: draft.trim(),
          channelId: channelId || null,
          windowStart: window?.start,
          windowEnd: window?.end,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(
        channelId ? "Handover published to the channel" : "Handover saved",
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't publish");
      setPhase("editing");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[0.9375rem] font-medium tracking-tight">
            <ArrowRightLeft className="size-4" />
            Shift handover
          </DialogTitle>
          <DialogDescription className="text-[0.8125rem] tracking-tight text-muted-foreground">
            Drafted from this shift&apos;s actual activity — edit it, then
            publish it under your name.
          </DialogDescription>
        </DialogHeader>

        {phase === "drafting" ? (
          <p className="flex items-center gap-2 py-8 text-[0.8125rem] text-muted-foreground">
            <Sparkles className="size-4" />
            <Loader2 className="size-3.5 animate-spin" />
            Reading the shift&apos;s activity…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              disabled={phase === "publishing"}
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[0.8125rem] leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
            <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              Post to
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                disabled={phase === "publishing"}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-[0.8125rem] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">No channel — just save</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={phase === "publishing"}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void publish()}
            disabled={phase !== "editing" || draft.trim().length === 0}
          >
            {phase === "publishing" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
