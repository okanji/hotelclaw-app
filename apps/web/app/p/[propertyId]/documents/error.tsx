"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Documents-segment error boundary. Catches Tiptap/Liveblocks failures in
 * the editor or doc tree without taking down chat, tasks, or calendar.
 */
export default function DocumentsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[documents-section] error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <h2 className="text-base font-semibold">Documents couldn’t load</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        We’ll keep the rest of the workspace open — try reloading this section.
      </p>
      <Button type="button" size="sm" onClick={() => unstable_retry()}>
        Reload documents
      </Button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Ref: {error.digest}</p>
      ) : null}
    </div>
  );
}
