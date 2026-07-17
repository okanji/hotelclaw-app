"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Guest self-cancel from the signed manage link — two-tap confirm. */
export function CancelBookingButton({ token }: { token: string }) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/guest/book/manage/${token}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't cancel — contact the venue.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
      setArming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {arming ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="h-11 flex-1 rounded-full bg-guest-danger text-base font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </button>
          <button
            type="button"
            onClick={() => setArming(false)}
            disabled={busy}
            className="h-11 flex-1 rounded-full border border-guest-ink/15 bg-white text-base text-guest-ink"
          >
            Keep it
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setArming(true)}
          className="h-11 rounded-full border border-guest-danger/40 bg-white text-base font-medium text-guest-danger"
        >
          Cancel this booking
        </button>
      )}
      {error ? <p className="text-sm text-guest-danger">{error}</p> : null}
    </div>
  );
}
