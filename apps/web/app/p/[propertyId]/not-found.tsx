"use client";

import Link from "next/link";
import { FileQuestionMark } from "lucide-react";
import { FullState, GoBackButton } from "@/components/shell/route-error";

/**
 * In-shell 404 for the property content pane — rendered when a page throws
 * `notFound()` (e.g. a task or document that was deleted or archived, often
 * reached via a stale link the sidebar remembered in localStorage). The
 * sidebar stays mounted; only this pane shows gr8r's `page404`.
 *
 * A client component for the same reason as `app/not-found.tsx`: handing a
 * rendered Lucide element across the client boundary breaks the minified
 * production render.
 */
export default function PropertyNotFound() {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <FullState
        icon={FileQuestionMark}
        code="ERROR 404"
        title="Not found"
        message="This item doesn't exist anymore — it may have been deleted or archived. Check the link or head back home."
      >
        <GoBackButton />
        <Link href="/" className="btn btn-primary">
          Go to Home
        </Link>
      </FullState>
    </div>
  );
}
