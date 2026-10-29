"use client";

import { useEffect } from "react";

/**
 * Meetings-segment error boundary. A failure in transcript fetch or the
 * Stream Video provider shouldn't break the rest of the property shell.
 */
export default function MeetingsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[meetings-section] error:", error);
  }, [error]);

  return (
    <div className="empty-state err" style={{ height: "100%", justifyContent: "center" }}>
      <h3 className="es-h">Meetings couldn’t load</h3>
      <p>We’ll keep the rest of the workspace open — try reloading this section.</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => unstable_retry()}>
        Reload meetings
      </button>
      {error.digest ? <span className="hint">Ref: {error.digest}</span> : null}
    </div>
  );
}
