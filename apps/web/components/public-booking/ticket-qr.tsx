"use client";

import QRCode from "react-qr-code";

/**
 * The door ticket — a QR of this booking's own manage URL. Door staff scan
 * it (or just read the reference), open the booking, and tap Check in.
 */
export function TicketQr({ url, reference }: { url: string; reference: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-guest-ink/20 bg-white p-5">
      <QRCode value={url} size={140} />
      <p className="font-mono text-sm font-semibold tracking-widest text-guest-ink">
        {reference}
      </p>
      <p className="text-xs text-guest-ink-soft">Show this at the door</p>
    </div>
  );
}
