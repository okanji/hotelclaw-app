"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared error pane for narrow auth/invite route segments. The top-level
 * `app/error.tsx` covers the workspace shell; this one is intentionally
 * smaller — it slots into a form-sized layout without forcing a full-screen
 * takeover, which matters for login/forgot-password/invite flows where the
 * surrounding chrome is minimal anyway.
 */
export function RouteError({
  error,
  reset,
  title = "Something went wrong",
  message = "Please try again.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  message?: string;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  // Quiet by construction: no card, no ring, no status color, no icon plate.
  // A 16px/600 title, 14px muted copy, one button, and the digest on the
  // 12px faint rung (it's a caption, not body text).
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-12 text-center">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold text-balance">{title}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{message}</p>
      </div>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
      {error.digest ? (
        <p className="font-mono text-xs text-faint-foreground">
          Ref: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
