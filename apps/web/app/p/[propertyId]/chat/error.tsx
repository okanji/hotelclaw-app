"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";

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
    <div className="flex h-full flex-1 flex-col items-center justify-center">
      <div className="empty-state err">
        <div className="glyph">
          <Gi icon={TriangleAlert} size={20} />
        </div>
        <h2 className="es-h">Chat couldn’t load</h2>
        <p>
          We’ll keep the rest of the workspace open — try reloading this
          section.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => unstable_retry()}
        >
          Reload chat
        </button>
        {error.digest ? (
          <p className="faint" style={{ marginTop: 8, fontSize: "var(--g8-fs-xs)" }}>
            Ref: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
