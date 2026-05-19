"use client";

/**
 * `subPage` — a Tiptap block node that embeds a link to a nested document,
 * Notion-style. The node stores only the child document's id; its title is
 * resolved live from Postgres by the node view so a rename in the child shows
 * here without rewriting the Yjs doc.
 *
 * Sub-pages are created by the `/page` slash command (see `slash-command.tsx`),
 * which inserts this node *and* the matching `documents` row (with
 * `parent_id` set), so the block and the sidebar tree always agree.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Node,
  mergeAttributes,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronRight, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

export const SubPage = Node.create({
  name: "subPage",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      documentId: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-document-id"),
        renderHTML: (attrs) =>
          attrs.documentId
            ? { "data-document-id": attrs.documentId as string }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-sub-page]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-sub-page": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubPageView);
  },
});

function SubPageView({ node }: NodeViewProps) {
  const documentId = node.attrs.documentId as string | null;
  const params = useParams<{ propertyId: string }>();
  const router = useRouter();
  const [title, setTitle] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // A node with no id is broken from the start; an existing id resolves to
  // `notFound` only once the lookup says so.
  const missing = !documentId || notFound;

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    void supabase
      .from("documents")
      .select("title, archived_at")
      .eq("id", documentId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data || data.archived_at) {
          setNotFound(true);
          return;
        }
        setTitle(data.title);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  function open() {
    if (!documentId || missing || !params?.propertyId) return;
    router.push(`/p/${params.propertyId}/documents/${documentId}`);
  }

  return (
    <NodeViewWrapper className="sub-page-node my-1.5">
      <button
        type="button"
        contentEditable={false}
        onClick={open}
        disabled={missing}
        className={cn(
          "group/subpage flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
          "hover:border-border hover:bg-muted",
          "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
        )}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium underline-offset-2 group-hover/subpage:underline">
          {missing ? "Sub-page (unavailable)" : (title ?? "Untitled")}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/subpage:opacity-100" />
      </button>
    </NodeViewWrapper>
  );
}
