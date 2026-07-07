import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Global 404 — shown for URLs that match no route, and for `notFound()`
 * thrown above the property shell (e.g. an archived or non-existent
 * property). Rendered inside the root layout, so it has no app chrome.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This page doesn&apos;t exist, or you no longer have access to it.
        </p>
      </div>
      <Button render={<Link href="/" />}>Back to your workspace</Button>
    </div>
  );
}
