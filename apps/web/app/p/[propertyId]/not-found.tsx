import Link from "next/link";

/**
 * In-shell 404 for the property content pane — rendered when a page throws
 * `notFound()` (e.g. a task or document that was deleted or archived, often
 * reached via a stale link the rail remembered in localStorage). The rail and
 * sidebar stay mounted; only this pane shows the fallback.
 */
export default function PropertyNotFound() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Not found</h2>
        <p className="text-sm text-muted-foreground">
          This item doesn&apos;t exist anymore — it may have been deleted or
          archived.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
      >
        Back to your workspace
      </Link>
    </div>
  );
}
