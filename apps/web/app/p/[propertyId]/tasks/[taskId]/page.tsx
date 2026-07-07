/**
 * Task route landing. The detail is rendered by `<TasksSurface>` in
 * `tasks/layout.tsx` (it reads the active task from the URL), so this page is
 * `null` and exists only so `/tasks/[taskId]` URLs resolve on a hard load /
 * deep link.
 */
export default function TaskDetailPage() {
  return null;
}
