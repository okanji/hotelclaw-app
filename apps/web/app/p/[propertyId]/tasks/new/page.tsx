/**
 * Full-page task-create landing. Rendering is owned by `<TasksSurface>` in the
 * property layout (it matches `/tasks/new` and mounts `<TaskCreatePage>`), so
 * this page is `null` and exists only so the URL resolves on a hard load /
 * deep link — mirroring `tasks/page.tsx` and `tasks/[taskId]/page.tsx`.
 */
export default function NewTaskPage() {
  return null;
}
