"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Gi } from "@/components/gr8r/icon";
import { createClient } from "@/lib/supabase/client";

/** The model call is ~10–60s; past this, assume the background run died. */
const GIVE_UP_MS = 3 * 60 * 1000;

/**
 * Re-run a meeting's summary from its stored transcript
 * (`POST /api/meetings/:id/summarize`, which works in `after()`). The new
 * `meeting_summaries` row arrives over realtime and we `router.refresh()`
 * the server-rendered page; a run that never lands times out back to idle.
 */
export function RegenerateSummaryButton({
  meetingId,
  label = "Regenerate summary",
  variant = "outline",
}: {
  meetingId: string;
  label?: string;
  variant?: "outline" | "ghost";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!busy) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`meeting-summary-${meetingId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "meeting_summaries",
          filter: `meeting_id=eq.${meetingId}`,
        },
        () => {
          setBusy(false);
          toast.success("Summary regenerated");
          router.refresh();
        },
      )
      .subscribe();
    timer.current = setTimeout(() => {
      setBusy(false);
      // Realtime may have missed it — refresh anyway, then say so.
      router.refresh();
      toast.error("The summary didn't regenerate. Try again in a moment.");
    }, GIVE_UP_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [busy, meetingId, router]);

  async function start() {
    setBusy(true);
    try {
      const r = await fetch(`/api/meetings/${meetingId}/summarize`, {
        method: "POST",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setBusy(false);
      toast.error(
        `Couldn't regenerate: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  }

  return (
    <button
      type="button"
      className={variant === "ghost" ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"}
      disabled={busy}
      onClick={() => void start()}
    >
      <Gi icon={RefreshCw} size={13} className={busy ? "animate-spin" : undefined} />
      {busy ? "Regenerating…" : label}
    </button>
  );
}
