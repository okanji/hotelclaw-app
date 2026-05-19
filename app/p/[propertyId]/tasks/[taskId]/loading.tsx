import { TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";

/**
 * Suspense fallback for an individual task, shaped like <TaskDetail>. The
 * page's RSC does no blocking fetch — the task list streams in — so this
 * renders for ~0 frames on a warm navigation from the board.
 */
export default function TaskDetailLoading() {
  return <TaskDetailSkeleton />;
}
