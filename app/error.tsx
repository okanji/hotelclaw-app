"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * App-level error boundary — catches render errors that escape a section,
 * e.g. in the property `layout`'s providers or an auth page. Section-page
 * errors are caught closer by `app/p/[propertyId]/error.tsx`, which keeps the
 * app shell mounted.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error stopped this page from loading.
        </p>
      </div>
      <Button type="button" onClick={() => unstable_retry()}>
        Try again
      </Button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
