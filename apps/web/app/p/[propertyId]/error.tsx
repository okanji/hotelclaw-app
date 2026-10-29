"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CloudAlert } from "lucide-react";
import { FullState, RetryButton } from "@/components/shell/route-error";

/**
 * Error boundary for the property content pane. Catches render errors in the
 * section pages (chat, tasks, docs, …). It wraps the pages but not the
 * property `layout`, so the sidebar and providers stay mounted — only this
 * pane shows gr8r's `stateFailed`, and the user can navigate elsewhere.
 */
export default function PropertyError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const { propertyId } = useParams<{ propertyId: string }>();
  useEffect(() => {
    console.error("Section route error:", error);
  }, [error]);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <FullState
        icon={CloudAlert}
        title="Something went wrong."
        message="This section failed to load. Your data is safe and your other sections are unaffected — try again in a moment."
        failed
        digest={error.digest}
      >
        <Link href={`/p/${propertyId}/home`} className="btn btn-secondary">
          Go to Home
        </Link>
        <RetryButton onClick={() => unstable_retry()} />
      </FullState>
    </div>
  );
}
