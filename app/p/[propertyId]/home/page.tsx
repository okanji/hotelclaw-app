// The Home surface is rendered by `<HomeSurface>` in the property layout (it
// matches on the `/home` URL prefix), so this route's page renders nothing —
// the same null-page pattern every other section uses. Keeping the route file
// makes `/p/<id>/home` a real, navigable URL.
export default function HomePage() {
  return null;
}
