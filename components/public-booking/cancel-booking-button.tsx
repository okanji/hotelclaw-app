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
            className="h-11 flex-1 rounded-full bg-[#b91c1c] text-base font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </button>
          <button
            type="button"
            onClick={() => setArming(false)}
            disabled={busy}
            className="h-11 flex-1 rounded-full border border-[#1f1e1b]/15 bg-white text-base text-[#1f1e1b]"
          >
            Keep it
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setArming(true)}
          className="h-11 rounded-full border border-[#b91c1c]/40 bg-white text-base font-medium text-[#b91c1c]"
        >
          Cancel this booking
        </button>
      )}
      {error ? <p className="text-sm text-[#b91c1c]">{error}</p> : null}
    </div>
  );
}
