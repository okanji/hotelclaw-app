/**
 * Project route landing. The project workspace is rendered by
 * `<ProjectsSurface>` in the property layout (it reads the active project id
 * from the URL), so this page is `null` and exists only so
 * `/projects/[projectId]` URLs resolve on a hard load / deep link.
 */
export default function ProjectPage() {
  return null;
}
