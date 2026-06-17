// My Tasks is rendered by `<MyTasksSurface>` in the property layout (it matches
// on the `/my-tasks` URL), so this route's page renders nothing — the same
// null-page pattern every other section uses. Keeping the route file makes
// `/p/<id>/my-tasks` a real, navigable URL.
export default function MyTasksPage() {
  return null;
}
