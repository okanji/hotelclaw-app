import { Loader2 } from "lucide-react";

/**
 * Suspense fallback for the Documents segment — covers both the index list
 * and an individual document. Without it, navigating here keeps the previous
 * page on screen for the whole server roundtrip. Mirrors `DocumentEditor`'s
 * own `EditorSkeleton` so opening a document has a continuous loading state.
 */
export default function DocumentsLoading() {
  return (
    <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading…
    </div>
  );
}
