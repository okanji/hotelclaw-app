"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ClipboardList,
  FileText,
  FolderKanban,
  Inbox,
  ListTodo,
  Plus,
  Star,
  UserCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  documentsQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { usePinnedDocs } from "@/lib/documents/use-pinned-docs";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { CreateDocumentDialog } from "@/components/documents/create-document-dialog";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import { useNotifications } from "./use-notifications";

/**
 * The personal block pinned at the top of EVERY section sidebar (gr8r /
 * ClickUp's Home sidebar): Inbox, My tasks, Favorites. These used to be
 * scattered — My tasks + Favorites lived only in the Home sidebar, and the
 * notification inbox only behind the Activity rail item — so "my stuff" was
 * reachable from one section at a time.
 *
 * Inbox is the NOTIFICATION inbox (`/activity`, ClickUp's meaning). Chat's
 * @-mention feed at `/inbox` is labelled "Mentions" to keep the two apart.
 */
export function YouBlock({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  const base = `/p/${propertyId}`;
  const { unseenCount } = useNotifications(userId);

  // Same cut as gr8r's My Tasks badge: mine, open, due today or overdue —
  // the number worth acting on, not the whole backlog.
  const { data: tasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const dueMine = useMemo(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return tasks.filter(
      (t) =>
        t.assignee_id === userId &&
        t.status !== "done" &&
        !!t.due_at &&
        new Date(t.due_at) <= endOfToday,
    ).length;
  }, [tasks, userId]);

  const inboxActive =
    pathname.startsWith(`${base}/activity`) &&
    (view === null || view === "inbox");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link href={`${base}/activity`} />}
          isActive={inboxActive}
          tooltip="Inbox"
        >
          <Inbox />
          <span>Inbox</span>
        </SidebarMenuButton>
        {unseenCount > 0 ? (
          <SidebarMenuBadge>{unseenCount > 99 ? "99+" : unseenCount}</SidebarMenuBadge>
        ) : null}
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link href={`${base}/my-tasks`} />}
          isActive={pathname.startsWith(`${base}/my-tasks`)}
          tooltip="My tasks"
        >
          <UserCheck />
          <span>My tasks</span>
        </SidebarMenuButton>
        {dueMine > 0 ? (
          <SidebarMenuBadge title="Due today or overdue">
            {dueMine > 99 ? "99+" : dueMine}
          </SidebarMenuBadge>
        ) : null}
      </SidebarMenuItem>
      <FavoritesItem propertyId={propertyId} />
    </SidebarMenu>
  );
}

const FAVORITES_OPEN_KEY = "hotelclaw:favorites-open";

/** Starred docs, folded under one row so the block stays three lines tall. */
function FavoritesItem({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const openDocument = useOpenDocument(propertyId);
  const { pinnedIds } = usePinnedDocs(propertyId);
  const { data: docs = [] } = useQuery(documentsQueryOptions(propertyId));
  const favorites = useMemo(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    return pinnedIds
      .map((id) => byId.get(id))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .slice(0, 8);
  }, [pinnedIds, docs]);

  // Read after mount — localStorage on the server render would mismatch.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem(FAVORITES_OPEN_KEY) === "1") setOpen(true);
    } catch {
      // Storage unavailable — start collapsed.
    }
  }, []);
  function toggle() {
    setOpen((o) => {
      try {
        window.localStorage.setItem(FAVORITES_OPEN_KEY, o ? "0" : "1");
      } catch {
        // Preference only.
      }
      return !o;
    });
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<button type="button" />}
        onClick={toggle}
        aria-expanded={open}
        tooltip="Favorites"
      >
        <Star />
        <span>Favorites</span>
      </SidebarMenuButton>
      <SidebarMenuAction onClick={toggle} aria-label={open ? "Collapse favorites" : "Expand favorites"}>
        <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
      </SidebarMenuAction>
      {open ? (
        <SidebarMenuSub>
          {favorites.length === 0 ? (
            <p className="px-2 py-1 text-xs text-pretty text-faint-foreground">
              Star a document to keep it here.
            </p>
          ) : (
            favorites.map((d) => (
              <SidebarMenuSubItem key={d.id}>
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  onClick={() => openDocument(d.id)}
                  isActive={pathname.includes(`/documents/${d.id}`)}
                >
                  <FileText />
                  <span>{d.title || "Untitled"}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))
          )}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

/**
 * The one "create anything" entry, in the same spot in every section (gr8r's
 * top-bar "New ▾"). Each item reuses the create flow its own section already
 * owns — no second implementation of any of them.
 */
export function NewMenu({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const base = `/p/${propertyId}`;
  const [docOpen, setDocOpen] = useState(false);
  const [entity, setEntity] = useState<{
    open: boolean;
    kind: "space" | "project";
  }>({ open: false, kind: "project" });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Create new"
          title="Create new"
          className="flex size-[30px] shrink-0 items-center justify-center rounded-md text-secondary-ink outline-hidden transition-colors hover:bg-sidebar-accent focus-visible:shadow-focus data-[popup-open]:bg-sidebar-accent"
        >
          <Plus className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="w-52">
          <DropdownMenuItem onClick={() => router.push(`${base}/tasks/new`)}>
            <ListTodo />
            <span className="flex-1">Task</span>
            <span className="text-xs text-faint-foreground">N</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDocOpen(true)}>
            <FileText />
            <span>Document</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(`${base}/forms?new=1`)}>
            <ClipboardList />
            <span>Form</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setEntity({ open: true, kind: "project" })}
          >
            <FolderKanban />
            <span>Project</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setEntity({ open: true, kind: "space" })}
          >
            <Users />
            <span>Team</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateDocumentDialog
        open={docOpen}
        onOpenChange={setDocOpen}
        propertyId={propertyId}
      />
      <CreateEntityDialog
        open={entity.open}
        onOpenChange={(open) => setEntity((e) => ({ ...e, open }))}
        propertyId={propertyId}
        kind={entity.kind}
      />
    </>
  );
}
