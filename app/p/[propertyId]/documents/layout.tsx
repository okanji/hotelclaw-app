import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getServerQueryClient } from "@/lib/query/server";
import { getDocuments, getDocumentsTree } from "@/lib/documents/queries";

// Liveblocks UI defaults — used by FloatingComposer, FloatingThreads,
// FloatingToolbar, Toolbar (everything in `@liveblocks/react-tiptap`).
import "@liveblocks/react-ui/styles.css";
// Class-attribute dark theme: responds to `.dark`, `[data-theme=dark]`, or
// `[data-dark]` on any ancestor — matches how the app's shadcn setup toggles
// dark mode.
import "@liveblocks/react-ui/styles/dark/attributes.css";
import "@liveblocks/react-tiptap/styles.css";
import "@/app/documents-editor.css";

/**
 * Docs section layout — only does the server-streamed prefetch into the
 * shared React Query cache plus the Liveblocks/Tiptap CSS imports. The
 * actual rendering surface (`<DocumentsSurface>`) lives one level up in
 * the property layout so cross-section rail clicks are `pushState`s; on a
 * hard load of `/documents` or `/documents/[id]`, this hydration runs first
 * and the property-layout surface picks up warm data.
 *
 * Every page.tsx under this layout is `null`; rendering is owned by the
 * property-layout surface.
 */
export default async function DocumentsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  await requireUser();

  const queryClient = getServerQueryClient();
  const supabase = await createClient();
  void queryClient.prefetchQuery({
    queryKey: ["documents", propertyId],
    queryFn: () => getDocuments(supabase, propertyId),
  });
  // `DocumentEditor` reads the open doc's title + ancestors out of the
  // `["documents-tree", propertyId]` cache and `notFound()`s on a miss — so a
  // hard load of `/documents/[id]` needs the tree warm on the very first
  // client render, before the rail's post-mount prefetch can run.
  void queryClient.prefetchQuery({
    queryKey: ["documents-tree", propertyId],
    queryFn: () => getDocumentsTree(supabase, propertyId),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
