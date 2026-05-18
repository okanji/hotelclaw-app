"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Archive,
  ChevronRight,
  CornerLeftUp,
  FileText,
  LayoutGrid,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  archiveDocument,
  createDocument,
  moveDocument,
} from "./actions";
import { ArchivedDocumentsDialog } from "./archived-documents-dialog";

type DocRow = {
  id: string;
  title: string;
  parent_id: string | null;
  position: number;
  updated_at: string;
};

type TreeNode = { doc: DocRow; children: TreeNode[] };

/** Sentinel droppable id — the "All documents" row, i.e. move to top level. */
const ROOT_DROP_ID = "__doc_root__";
/** Indentation step per nesting level, in pixels. */
const INDENT = 14;

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

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // Restore the saved expand/collapse state before the first paint of the
  // tree, keyed per-property so switching properties doesn't bleed state.
  const storageKey = `hotelclaw:docs-expanded:${propertyId}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
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

  useEffect(() => {
    const supabase = createBrowserClient();
    let cancelled = false;

    void supabase
      .from("documents")
      .select("id, title, parent_id, position, updated_at")
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("position", { ascending: true })
      .limit(500)
      .then(({ data }) => {
        if (cancelled) return;
        setDocs((data ?? []) as DocRow[]);
        setLoaded(true);
      });

    const channel = supabase
      .channel(`documents:${propertyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `property_id=eq.${propertyId}`,
        },
        (payload) => {
          setDocs((current) => reduce(current, payload as RealtimePayload));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [propertyId]);

  const { roots, childrenOf, parentOf } = useMemo(
    () => buildTree(docs),
    [docs],
  );

  // Auto-expand the ancestors of the open document so it's always visible in
  // the tree after a deep-link or a navigation from breadcrumbs.
  useEffect(() => {
    if (!activeId) return;
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
      if (parentId) expand(parentId);
      router.push(`/p/${propertyId}/documents/${res.id}`);
    },
    [propertyId, router, expand],
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
      const snapshot = docs;
      const siblings = docs.filter((d) => (d.parent_id ?? null) === newParent);
      const maxPos = siblings.reduce((m, d) => Math.max(m, d.position), 0);
      setDocs((current) =>
        current.map((d) =>
          d.id === id
            ? { ...d, parent_id: newParent, position: maxPos + 1024 }
            : d,
        ),
      );
      if (newParent) expand(newParent);

      void moveDocument(id, newParent).then((res) => {
        if ("error" in res) {
          toast.error(res.error);
          setDocs(snapshot);
        }
      });
    },
    [docs, disabledDropIds, expand],
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
    <SidebarGroup>
      <SidebarGroupLabel>Documents</SidebarGroupLabel>
      <SidebarGroupAction
        onClick={() => void onCreate(null)}
        title="New document"
      >
        <Plus />
      </SidebarGroupAction>
      <SidebarGroupContent>
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggedId(null)}
        >
          <TreeContext.Provider value={ctx}>
            <SidebarMenu>
              <DocumentsHomeItem propertyId={propertyId} pathname={pathname} />
            </SidebarMenu>

            {!loaded ? null : roots.length === 0 ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                No documents yet
              </div>
            ) : (
              <SidebarMenu>
                {roots.map((node) => (
                  <DocTreeNode key={node.doc.id} node={node} depth={0} />
                ))}
              </SidebarMenu>
            )}

            {loaded ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    onClick={() => setArchivedOpen(true)}
                    tooltip="Archived documents"
                    className="text-sidebar-foreground/55 [&_svg]:size-3.5 [&_svg]:opacity-60"
                  >
                    <Archive />
                    <span>Archived</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : null}
          </TreeContext.Provider>

          <DragOverlay dropAnimation={null}>
            {draggedDoc ? (
              <div className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar px-2 py-1 text-[13px] shadow-lg">
                <FileText className="size-4 shrink-0 opacity-70" />
                <span className="truncate">
                  {draggedDoc.title || "Untitled"}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </SidebarGroupContent>

      <ArchivedDocumentsDialog
        propertyId={propertyId}
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
      />
    </SidebarGroup>
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
 * Links to the documents dashboard (`/p/<id>/documents`). Also a drop target —
 * dragging a doc here promotes it back to the top level.
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
    <SidebarMenuItem ref={setNodeRef}>
      <SidebarMenuButton
        render={<Link href={href} draggable={false} />}
        isActive={isActive}
        tooltip="All documents"
        className={cn(
          isOver && "ring-2 ring-sidebar-ring ring-inset",
        )}
      >
        <LayoutGrid />
        <span className="truncate">All documents</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ── Recursive tree node ─────────────────────────────────────────────────────

function DocTreeNode({ node, depth }: { node: TreeNode; depth: number }) {
  const tree = useTree();
  const { doc, children } = node;
  const hasChildren = children.length > 0;
  const isExpanded = tree.expanded.has(doc.id);
  const href = `/p/${tree.propertyId}/documents/${doc.id}`;
  const isActive =
    tree.activeId === doc.id || tree.pathname === href;

  const draggable = useDraggable({ id: doc.id });
  const droppable = useDroppable({
    id: doc.id,
    disabled: tree.disabledDropIds.has(doc.id),
  });

  // Merge the drag-source and drop-target refs onto the row element.
  const setRowRef = useCallback(
    (el: HTMLLIElement | null) => {
      draggable.setNodeRef(el);
      droppable.setNodeRef(el);
    },
    [draggable, droppable],
  );

  const isDropTarget =
    droppable.isOver && tree.draggedId !== null && tree.draggedId !== doc.id;

  return (
    <>
      <SidebarMenuItem
        ref={setRowRef}
        {...draggable.attributes}
        {...draggable.listeners}
        className={cn(draggable.isDragging && "opacity-40")}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isExpanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              tree.toggle(doc.id);
            }}
            className="absolute top-1.5 z-10 flex size-4 items-center justify-center rounded-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            style={{ left: depth * INDENT + 4 }}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform",
                isExpanded && "rotate-90",
              )}
            />
          </button>
        ) : null}

        <SidebarMenuButton
          render={<Link href={href} draggable={false} />}
          isActive={isActive}
          tooltip={doc.title || "Untitled"}
          className={cn(
            "pr-14",
            isDropTarget && "ring-2 ring-sidebar-ring ring-inset",
          )}
          style={{ paddingLeft: depth * INDENT + 24 }}
        >
          <FileText />
          <span className="truncate">{doc.title || "Untitled"}</span>
        </SidebarMenuButton>

        <SidebarMenuAction
          showOnHover
          onClick={() => tree.onCreateChild(doc.id)}
          title="Add a sub-page"
          aria-label="Add a sub-page"
          className="right-7"
        >
          <Plus />
        </SidebarMenuAction>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction showOnHover aria-label="Document actions" />
            }
          >
            <MoreHorizontal />
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
      </SidebarMenuItem>

      {hasChildren && isExpanded
        ? children.map((child) => (
            <DocTreeNode key={child.doc.id} node={child} depth={depth + 1} />
          ))
        : null}
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
  };
  return [...without, next];
}
