import { TasksBoardSkeleton } from "@/components/tasks/board-skeleton";

/**
 * Suspense fallback for the Tasks route, shaped like the real board so the
 * transition shows no jump. The page's RSC does no blocking data fetch — the
 * task list streams in — so this renders for ~0 frames on a warm navigation.
 */
export default function TasksLoading() {
  return <TasksBoardSkeleton />;
}
