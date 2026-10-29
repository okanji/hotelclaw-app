"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CloudAlert } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { FullState, RetryButton } from "@/components/shell/route-error";

/**
 * App-level error boundary — catches render errors that escape a section,
 * e.g. in the property `layout`'s providers or an auth page. Section-page
 * errors are caught closer by `app/p/[propertyId]/error.tsx`, which keeps the
 * app shell mounted. gr8r's `stateFailed`, in the auth frame (there is no
 * shell to sit in here).
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
    <AuthShell>
      <FullState
        icon={CloudAlert}
        title="Something went wrong."
        message="An unexpected error stopped this page from loading. Your data is safe — try again in a moment."
        failed
        digest={error.digest}
      >
        <Link href="/" className="btn btn-secondary">
          Go to Home
        </Link>
        <RetryButton onClick={() => unstable_retry()} />
      </FullState>
    </AuthShell>
  );
}
