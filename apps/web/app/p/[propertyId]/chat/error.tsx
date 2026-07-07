"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Chat-segment error boundary. Catches errors below `chat/` so the channel
 * list and conversation pane fail independently of the rest of the property
 * shell (documents, tasks, calendar all keep working).
 */
export default function ChatError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[chat-section] error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <h2 className="text-base font-semibold">Chat couldn’t load</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        We’ll keep the rest of the workspace open — try reloading this section.
      </p>
      <Button type="button" size="sm" onClick={() => unstable_retry()}>
        Reload chat
      </Button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Ref: {error.digest}</p>
      ) : null}
    </div>
  );
}
