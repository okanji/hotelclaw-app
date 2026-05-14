// Liveblocks UI defaults — used by FloatingComposer, FloatingThreads,
// FloatingToolbar, Toolbar (everything in `@liveblocks/react-tiptap`).
import "@liveblocks/react-ui/styles.css";
import "@liveblocks/react-tiptap/styles.css";
import "@/app/documents-editor.css";

export default function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex h-full min-h-0 flex-1 flex-col">{children}</div>;
}
