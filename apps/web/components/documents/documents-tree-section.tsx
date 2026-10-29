"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Archive,
  ChevronRight,
  ClipboardList,
  CornerLeftUp,
  FileText,
  Home,
  LayoutList,
  MoreHorizontal,
  Plus,
  Table2,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { Gi } from "@/components/gr8r/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  documentsTreeQueryOptions,
  formsListQueryOptions,
  type DocumentTreeRow,
} from "@/lib/query/section-queries";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { usePrewarmDocument } from "@/lib/liveblocks/use-prewarm-document";
import {
  archiveDocument,
  createDocument,
  moveDocument,
} from "./actions";
import { ArchivedDocumentsDialog } from "./archived-documents-dialog";
import { CreateDocumentDialog } from "./create-document-dialog";

type DocRow = DocumentTreeRow;

type TreeNode = { doc: DocRow; children: TreeNode[] };

/** Sentinel droppable id — the "All documents" row, i.e. move to top level. */
const ROOT_DROP_ID = "__doc_root__";
/** Stable empty array so `buildTree`'s useMemo doesn't re-run every render. */
const EMPTY_DOCS: DocRow[] = [];

/**
 * Notion-style nested document tree for the current property.
 *
 * The hierarchy (parent/child/order) is Postgres state — Liveblocks only owns
 * each doc's content. We fetch the flat row set, subscribe to Supabase
 * realtime (`postgres_changes`) so creates/moves/archives from any client land
 * here without a refresh, and build the tree client-side.
 *
 * Renames are NOT exposed here — the first heading inside the editor IS the
 * title (synced to `documents.title`), so a separate sidebar rename would be
 * overwritten on the next edit.
 */
export function DocumentsTreeSection({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ documentId?: string }>();
  const activeId = params?.documentId;

  const queryClient = useQueryClient();
  const openDocument = useOpenDocument(propertyId);
  const { data, isPending } = useQuery(documentsTreeQueryOptions(propertyId));
  const docs = data ?? EMPTY_DOCS;
  const loaded = !isPending;
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // Restore the saved expand/collapse state before the first paint of the
  // tree, keyed per-property so switching properties doesn't bleed state.
  const storageKey = `hotelclaw:docs-expanded:${propertyId}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      // Client-only restore after hydration — `localStorage` is unavailable
      // during SSR, so this can't move into the `useState` initializer.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setExpanded(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignore malformed/disabled storage
    }
  }, [storageKey]);

  const persistExpanded = useCallback(
    (next: Set<string>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // ignore
      }
    },
    [storageKey],
  );

  // Realtime: patch the cached tree on any documents change for this property
  // so creates/moves/archives from any client land here without a refresh.
  // The initial fetch is owned by `useQuery` above.
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`documents:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `property_id=eq.${propertyId}`,
        },
        (payload) => {
          queryClient.setQueryData<DocRow[]>(
            documentsTreeQueryOptions(propertyId).queryKey,
            (current) => reduce(current ?? [], payload as RealtimePayload),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, queryClient]);

  const { roots, childrenOf, parentOf } = useMemo(
    () => buildTree(docs),
    [docs],
  );

  // Auto-expand the ancestors of the open document so it's always visible in
  // the tree after a deep-link or a navigation from breadcrumbs.
  useEffect(() => {
    if (!activeId) return;
    // Reveal the open document by expanding its ancestors — a one-shot sync
    // off navigation/data, not derivable during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded((current) => {
      const next = new Set(current);
      let cursor = parentOf.get(activeId) ?? null;
      let changed = false;
      while (cursor) {
        if (!next.has(cursor)) {
          next.add(cursor);
          changed = true;
        }
        cursor = parentOf.get(cursor) ?? null;
      }
      if (changed) persistExpanded(next);
      return changed ? next : current;
    });
  }, [activeId, parentOf, persistExpanded]);

  const toggle = useCallback(
    (id: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  const expand = useCallback(
    (id: string) => {
      setExpanded((current) => {
        if (current.has(id)) return current;
        const next = new Set(current).add(id);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  const onCreate = useCallback(
    async (parentId: string | null) => {
      const res = await createDocument(propertyId, parentId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }

      // Optimistically add the new doc to the tree cache so `DocumentEditor`
      // (which reads `documentsTreeQueryOptions` and `notFound()`s on miss)
      // finds it immediately — the postgres_changes event will reconcile.
      // Without this, navigating to the new doc races the realtime patch and
      // lands on the not-found page.
      const key = documentsTreeQueryOptions(propertyId).queryKey;
      queryClient.setQueryData<DocRow[]>(key, (current) => {
        const list = current ?? [];
        if (list.some((d) => d.id === res.id)) return list;
        const siblings = list.filter(
          (d) => (d.parent_id ?? null) === (parentId ?? null),
        );
        const maxPos = siblings.reduce((m, d) => Math.max(m, d.position), 0);
        return [
          ...list,
          {
            id: res.id,
            title: "Untitled document",
            parent_id: parentId,
            position: maxPos + 1024,
            updated_at: new Date().toISOString(),
            last_edited_by: null,
            kind: "doc",
          },
        ];
      });

      if (parentId) expand(parentId);
      openDocument(res.id);
    },
    [propertyId, openDocument, expand, queryClient],
  );

  const onArchive = useCallback(
    async (doc: DocRow) => {
      const res = await archiveDocument(doc.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      // If the open doc is the archived one or sits inside its subtree, the
      // page would 404 on the next load — get out now.
      if (activeId && (activeId === doc.id || isAncestor(doc.id, activeId, parentOf))) {
        router.push(`/p/${propertyId}/documents`);
      }
      toast.success(`Archived "${doc.title}"`);
    },
    [activeId, parentOf, propertyId, router],
  );

  // Drag-to-reparent. Dropping a doc onto another nests it; dropping onto the
  // "All documents" row promotes it to the top level.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // While dragging, the dragged doc and its whole subtree can't be drop
  // targets — that would orphan or loop the branch.
  const disabledDropIds = useMemo(() => {
    if (!draggedId) return new Set<string>();
    return subtreeIds(draggedId, childrenOf);
  }, [draggedId, childrenOf]);

  const onDragStart = useCallback((event: DragStartEvent) => {
    setDraggedId(String(event.active.id));
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggedId(null);
      const id = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (!overId) return;

      const newParent = overId === ROOT_DROP_ID ? null : overId;
      const doc = docs.find((d) => d.id === id);
      if (!doc) return;
      if (newParent === id) return;
      if ((doc.parent_id ?? null) === newParent) return;
      if (newParent && disabledDropIds.has(newParent)) return;

      // Optimistic: re-parent locally and append to the new sibling list, so
      // the tree settles instantly. Realtime will confirm (or this reverts).
      const key = documentsTreeQueryOptions(propertyId).queryKey;
      const snapshot = docs;
      const siblings = docs.filter((d) => (d.parent_id ?? null) === newParent);
      const maxPos = siblings.reduce((m, d) => Math.max(m, d.position), 0);
      queryClient.setQueryData<DocRow[]>(key, (current) =>
        (current ?? []).map((d) =>
          d.id === id
            ? { ...d, parent_id: newParent, position: maxPos + 1024 }
            : d,
        ),
      );
      if (newParent) expand(newParent);

      void moveDocument(id, newParent).then((res) => {
        if ("error" in res) {
          toast.error(res.error);
          queryClient.setQueryData<DocRow[]>(key, snapshot);
        }
      });
    },
    [docs, disabledDropIds, expand, propertyId, queryClient],
  );

  const draggedDoc = draggedId
    ? docs.find((d) => d.id === draggedId)
    : undefined;

  const ctx: TreeCtx = useMemo(
    () => ({
      propertyId,
      activeId,
      pathname,
      expanded,
      toggle,
      onCreateChild: (parentId: string) => void onCreate(parentId),
      onArchive: (doc: DocRow) => void onArchive(doc),
      onMoveToRoot: (doc: DocRow) => {
        void moveDocument(doc.id, null).then((res) => {
          if ("error" in res) toast.error(res.error);
        });
      },
      draggedId,
      disabledDropIds,
    }),
    [
      propertyId,
      activeId,
      pathname,
      expanded,
      toggle,
      onCreate,
      onArchive,
      draggedId,
      disabledDropIds,
    ],
  );

  return (
    // One DndContext spans both groups: the Home row (its own group, above)
    // is also a drop target for promote-to-root, so drags that start in the
    // tree need to register over it.
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDraggedId(null)}
    >
      <TreeContext.Provider value={ctx}>
        {/* Home — its own top-level group, separate from the doc tree so it
            reads as a standalone link to the dashboard, not the tree's root
            node. Mirrors Chat's Inbox/Threads-then-Channels pattern. */}
        <DocumentsHomeItem propertyId={propertyId} pathname={pathname} />

        <div className="sgroup g8-dt-group">
          <div className="sgroup-h">
            Documents
            <span className="sp" />
            <button
              type="button"
              className="ibtn ibtn-xs"
              onClick={() => setCreateOpen(true)}
              title="Create new"
              aria-label="Create new"
            >
              <Gi icon={Plus} size={13} />
            </button>
          </div>
          {!loaded ? null : roots.length === 0 ? (
            <p className="hint" style={{ padding: "4px 8px", margin: 0 }}>
              No documents yet
            </p>
          ) : (
            roots.map((node) => <DocTreeNode key={node.doc.id} node={node} />)
          )}

          {loaded ? (
            <button
              type="button"
              className="sitem g8-dt-faint"
              onClick={() => setArchivedOpen(true)}
              title="Archived documents"
            >
              <Gi icon={Archive} size={13} />
              <span className="trunc">Archived</span>
            </button>
          ) : null}
        </div>

        {/* Forms — authored artifacts, same library as documents. These are
            server-rendered routes (not surface-rendered), so rows use real
            <Link> navigation rather than the tree's pushState switching. */}
        <FormsSidebarGroup propertyId={propertyId} pathname={pathname} />
      </TreeContext.Provider>

      <PortalDragOverlay dropAnimation={null}>
        {draggedDoc ? (
          <div className="flex items-center gap-2 rounded-overlay bg-popover px-2.5 py-1.5 text-sm shadow-overlay">
            <FileText className="size-4 shrink-0 opacity-70" />
            <span className="truncate">
              {draggedDoc.title || "Untitled"}
            </span>
          </div>
        ) : null}
      </PortalDragOverlay>

      <ArchivedDocumentsDialog
        propertyId={propertyId}
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
      />
      <CreateDocumentDialog
        propertyId={propertyId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </DndContext>
  );
}

// ── Tree context ────────────────────────────────────────────────────────────

type TreeCtx = {
  propertyId: string;
  activeId?: string;
  pathname: string;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onArchive: (doc: DocRow) => void;
  onMoveToRoot: (doc: DocRow) => void;
  draggedId: string | null;
  disabledDropIds: Set<string>;
};

const TreeContext = createContext<TreeCtx | null>(null);

function useTree(): TreeCtx {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("useTree must be used inside DocumentsTreeSection");
  return ctx;
}

// ── "All documents" home row ────────────────────────────────────────────────

/**
 * Links to the docs Home / dashboard (`/p/<id>/documents`). Also a drop
 * target — dragging a doc here promotes it back to the top level of the
 * tree below.
 */
function DocumentsHomeItem({
  propertyId,
  pathname,
}: {
  propertyId: string;
  pathname: string;
}) {
  const href = `/p/${propertyId}/documents`;
  const isActive = pathname === href;
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP_ID });

  return (
    <Link
      ref={setNodeRef}
      href={href}
      draggable={false}
      className={cn("sitem", isActive && "on", isOver && "g8-dt-over")}
      title="All documents"
      aria-current={isActive ? "page" : undefined}
    >
      <Gi icon={Home} size={14} />
      {/* Not "Home" — that's the rail's Home section. */}
      <span className="trunc">All documents</span>
    </Link>
  );
}

// ── Forms group ─────────────────────────────────────────────────────────────

/**
 * Forms live in the Documents section — they're authored artifacts with the
 * same lifecycle as docs (build → share → collect). Unlike docs, form pages
 * are normal server-rendered routes, so every row is a real `<Link>`; the
 * rail's pushState gate excludes `/forms` for the same reason.
 */
function FormsSidebarGroup({
  propertyId,
  pathname,
}: {
  propertyId: string;
  pathname: string;
}) {
  const { data: forms = [] } = useQuery(formsListQueryOptions(propertyId));
  const base = `/p/${propertyId}/forms`;
  return (
    <div className="sgroup g8-dt-group">
      <div className="sgroup-h">Forms</div>
      {forms.map((f) => {
        const href = `${base}/${f.id}`;
        const on = pathname.startsWith(href);
        return (
          <Link
            key={f.id}
            href={href}
            className={on ? "sitem on" : "sitem"}
            title={f.title || "Untitled form"}
            aria-current={on ? "page" : undefined}
          >
            <Gi icon={ClipboardList} size={14} />
            <span className="trunc">{f.title || "Untitled form"}</span>
          </Link>
        );
      })}
      <Link
        href={base}
        className={pathname === base ? "sitem on" : "sitem g8-dt-faint"}
        title="All forms & responses"
      >
        <Gi icon={LayoutList} size={13} />
        <span className="trunc">All forms</span>
      </Link>
    </div>
  );
}

// ── Recursive tree node ─────────────────────────────────────────────────────

function DocTreeNode({ node }: { node: TreeNode }) {
  const tree = useTree();
  const openDocument = useOpenDocument(tree.propertyId);
  const prewarm = usePrewarmDocument(tree.propertyId);
  const { doc, children } = node;
  const hasChildren = children.length > 0;
  const isExpanded = tree.expanded.has(doc.id);
  const href = documentHref(tree.propertyId, doc.id);
  const isActive =
    tree.activeId === doc.id || tree.pathname === href;

  // Plain left-click → client-side `pushState` switch (no route nav, no
  // `documents/loading.tsx` flash). Modified clicks fall through to the
  // browser for "open in new tab" via the underlying `<a href>`.
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openDocument(doc.id);
  }

  const draggable = useDraggable({ id: doc.id });
  const droppable = useDroppable({
    id: doc.id,
    disabled: tree.disabledDropIds.has(doc.id),
  });

  // Merge the drag-source and drop-target refs onto the row element.
  const setRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      draggable.setNodeRef(el);
      droppable.setNodeRef(el);
    },
    [draggable, droppable],
  );

  const isDropTarget =
    droppable.isOver && tree.draggedId !== null && tree.draggedId !== doc.id;

  return (
    <>
      {/* gr8r `.sitem` row; sub-pages nest in a `.sub` (the guide line). The
          chevron sits over the type glyph and takes its place on hover, the
          add / menu actions are gr8r's hover-revealed `.hov` slot. */}
      <div
        ref={setRowRef}
        {...draggable.attributes}
        {...draggable.listeners}
        className={cn(
          "g8-dt-row",
          hasChildren && "has-kids",
          isExpanded && "is-open",
          draggable.isDragging && "dragging",
        )}
      >
        <Link
          href={href}
          draggable={false}
          onClick={handleClick}
          onMouseEnter={() => prewarm(doc.id)}
          className={cn("sitem", isActive && "on", isDropTarget && "g8-dt-over")}
          title={doc.title || "Untitled"}
          aria-current={isActive ? "page" : undefined}
        >
          <span className="g8-dt-ico">
            <Gi icon={doc.kind === "sheet" ? Table2 : FileText} size={14} />
          </span>
          <span className="trunc">{doc.title || "Untitled"}</span>
        </Link>

        {hasChildren ? (
          <button
            type="button"
            aria-label={isExpanded ? "Collapse" : "Expand"}
            aria-expanded={isExpanded}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              tree.toggle(doc.id);
            }}
            className="ibtn ibtn-xs g8-dt-chev"
          >
            <Gi icon={ChevronRight} size={13} className={isExpanded ? "chev open" : "chev"} />
          </button>
        ) : null}

        <span className="g8-dt-acts">
          <button
            type="button"
            className="ibtn ibtn-xs"
            onClick={() => tree.onCreateChild(doc.id)}
            title="Add a sub-page"
            aria-label="Add a sub-page"
          >
            <Gi icon={Plus} size={13} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="ibtn ibtn-xs"
                  aria-label="Document actions"
                />
              }
            >
              <Gi icon={MoreHorizontal} size={13} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem onClick={() => tree.onCreateChild(doc.id)}>
                <Plus className="size-4" /> Add sub-page
              </DropdownMenuItem>
              {doc.parent_id ? (
                <DropdownMenuItem onClick={() => tree.onMoveToRoot(doc)}>
                  <CornerLeftUp className="size-4" /> Move to top level
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => tree.onArchive(doc)}>
                <Archive className="size-4" /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      {hasChildren && isExpanded ? (
        <div className="sub open">
          {children.map((child) => (
            <DocTreeNode key={child.doc.id} node={child} />
          ))}
        </div>
      ) : null}
    </>
  );
}

// ── Tree building ───────────────────────────────────────────────────────────

function buildTree(docs: DocRow[]): {
  roots: TreeNode[];
  childrenOf: Map<string, TreeNode[]>;
  parentOf: Map<string, string>;
} {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const parentOf = new Map<string, string>();
  const groups = new Map<string | null, DocRow[]>();

  for (const doc of docs) {
    // A row whose parent is missing (archived out from under it, or filtered)
    // is treated as a root so it can never disappear from the tree.
    const parent =
      doc.parent_id && byId.has(doc.parent_id) ? doc.parent_id : null;
    if (parent) parentOf.set(doc.id, parent);
    const list = groups.get(parent) ?? [];
    list.push(doc);
    groups.set(parent, list);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.position - b.position);
  }

  const childrenOf = new Map<string, TreeNode[]>();
  const build = (doc: DocRow): TreeNode => {
    const kids = (groups.get(doc.id) ?? []).map(build);
    childrenOf.set(doc.id, kids);
    return { doc, children: kids };
  };

  const roots = (groups.get(null) ?? []).map(build);
  return { roots, childrenOf, parentOf };
}

/** All ids in the subtree rooted at `id`, inclusive. */
function subtreeIds(id: string, childrenOf: Map<string, TreeNode[]>): Set<string> {
  const out = new Set<string>([id]);
  const walk = (nodeId: string) => {
    for (const child of childrenOf.get(nodeId) ?? []) {
      out.add(child.doc.id);
      walk(child.doc.id);
    }
  };
  walk(id);
  return out;
}

/** Is `ancestorId` an ancestor of `nodeId`? */
function isAncestor(
  ancestorId: string,
  nodeId: string,
  parentOf: Map<string, string>,
): boolean {
  let cursor = parentOf.get(nodeId) ?? null;
  while (cursor) {
    if (cursor === ancestorId) return true;
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

// ── Realtime reducer ────────────────────────────────────────────────────────

type RealtimePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new:
    | (Partial<DocRow> & { archived_at?: string | null; property_id?: string })
    | null;
  old: { id?: string } | null;
};

/** Upsert/remove a row from the flat doc list — tree shape is derived later. */
function reduce(current: DocRow[], payload: RealtimePayload): DocRow[] {
  if (payload.eventType === "DELETE") {
    const id = payload.old?.id;
    return id ? current.filter((d) => d.id !== id) : current;
  }

  const row = payload.new;
  if (!row || !row.id) return current;

  const without = current.filter((d) => d.id !== row.id);
  // Archived rows leave the active tree (cascade archive emits one update
  // per descendant, so every nested row is dropped this way too).
  if (row.archived_at) return without;

  const next: DocRow = {
    id: row.id,
    title: row.title ?? "Untitled document",
    parent_id: row.parent_id ?? null,
    position: row.position ?? 0,
    updated_at: row.updated_at ?? new Date().toISOString(),
    last_edited_by: row.last_edited_by ?? null,
    kind: (row.kind as "doc" | "sheet") ?? "doc",
  };
  return [...without, next];
}
