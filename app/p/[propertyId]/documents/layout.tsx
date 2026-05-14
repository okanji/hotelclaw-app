// Liveblocks UI defaults — used by FloatingComposer, FloatingThreads,
// FloatingToolbar, Toolbar (everything in `@liveblocks/react-tiptap`).
import "@liveblocks/react-ui/styles.css";
// Class-attribute dark theme: responds to `.dark`, `[data-theme=dark]`, or
// `[data-dark]` on any ancestor — matches how the app's shadcn setup toggles
// dark mode.
import "@liveblocks/react-ui/styles/dark/attributes.css";
import "@liveblocks/react-tiptap/styles.css";
import "@/app/documents-editor.css";

export default function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex h-full min-h-0 flex-1 flex-col">{children}</div>;
}
