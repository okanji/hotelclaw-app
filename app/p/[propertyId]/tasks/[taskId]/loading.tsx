import { Loader2 } from "lucide-react";

/**
 * Suspense fallback for an individual task. Without it, opening a task falls
 * back to `tasks/loading.tsx` ("Loading tasks…"), whose board-shaped wording
 * reads oddly for a single task. Also makes the route independently
 * prefetchable (Next prefetches a dynamic route to its nearest loading file).
 */
export default function TaskDetailLoading() {
  return (
    <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Loading task…
    </div>
  );
}
