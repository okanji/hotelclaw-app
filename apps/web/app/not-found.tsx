"use client";

import Link from "next/link";
import { FileQuestionMark } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { FullState, GoBackButton } from "@/components/shell/route-error";

/**
 * Global 404 — shown for URLs that match no route, and for `notFound()`
 * thrown above the property shell (e.g. an archived or non-existent
 * property). Rendered inside the root layout, so it has no app chrome:
 * gr8r's `page404` in the auth frame.
 *
 * A CLIENT component on purpose (2026-10-29): as a server page it passed a
 * rendered `<Gi icon={…} />` element across the client boundary to
 * `FullState`, and the production (minified) build failed prerendering
 * `/_not-found` with "Element type is invalid … got: object" — the
 * development build was fine. On the client the Lucide component is just a
 * prop, so nothing crosses the RSC wire.
 */
export default function NotFound() {
  return (
    <AuthShell>
      <FullState
        icon={FileQuestionMark}
        code="ERROR 404"
        title="Page not found"
        message="This page doesn't exist, or you no longer have access to it. Check the link or head back to your workspace."
      >
        <GoBackButton />
        <Link href="/" className="btn btn-primary">
          Back to your workspace
        </Link>
      </FullState>
    </AuthShell>
  );
}
