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

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" size="sm" onClick={reset}>
        Try again
      </Button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Ref: {error.digest}</p>
      ) : null}
    </div>
  );
}
