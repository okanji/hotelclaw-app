"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the property content pane. Catches render errors in the
 * section pages (chat, tasks, docs, …). It wraps the pages but not the
 * property `layout`, so the rail, sidebar and providers stay mounted — only
 * this pane shows the fallback, and the user can navigate elsewhere.
 */
export default function PropertyError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Section route error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          This section failed to load. Your other sections are unaffected.
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
