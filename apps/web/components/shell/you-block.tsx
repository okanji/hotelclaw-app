"use client";

import { isDone } from "@/lib/tasks/statuses";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  MessagesSquare,
  ClipboardList,
  FileText,
  FolderKanban,
  ListTodo,
  Plus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
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
import {
  documentsQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { usePinnedDocs } from "@/lib/documents/use-pinned-docs";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { CreateDocumentDialog } from "@/components/documents/create-document-dialog";
import { CreateEntityDialog } from "@/components/projects/create-entity-dialog";
import { useNotifications } from "./use-notifications";
import { InboxIcon, MyTasksIcon, NewIcon } from "./clickup-icons";
import { NavNode, target } from "./nav-node";
import { usePrewarmSections, useSectionNavigation } from "./use-section-navigation";
import { useStoredToggle } from "./use-stored-toggle";
import { ActivitySection } from "./sections/activity-section";
import { AssistantSection } from "./sections/assistant-section";
import { ChatSection } from "./sections/chat-section";
import { DocumentsTreeSection } from "@/components/documents/documents-tree-section";

/**
 * The personal block at the top of the sidebar — Linear's Inbox / My issues /
 * Agent, ClickUp's Inbox / My Tasks: the three things that are about YOU,
 * before the Workspace tree that is about the property. Icons are ClickUp's
 * own glyphs (`clickup-icons.tsx`); the row metrics live in the shared
 * `SidebarMenuButton`.
 *
 * Inbox is the NOTIFICATION inbox (`/activity`, ClickUp's meaning); its
 * children are the inbox's filter views. Chat's @-mention feed and thread
 * replies live under the Chat node, labelled "Mentions" / "Replies" to keep
 * them apart. Assistant's children are its projects + recent conversations.
 *
 * Chat and Docs follow Assistant as FIXED rows (not pinnable apps): they are
 * where a person talks and writes all day, so they sit with the personal
 * block rather than in the Workspace pins.
 */
export function YouBlock({
  propertyId,
  userId,
  isManagement,
}: {
  propertyId: string;
  userId: string;
  isManagement: boolean;
}) {
  const pathname = usePathname();
  const base = `/p/${propertyId}`;
  const { navigate } = useSectionNavigation(propertyId);
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
        !isDone(t) &&
        !!t.due_at &&
        new Date(t.due_at) <= endOfToday,
    ).length;
  }, [tasks, userId]);

  const inbox = useMemo(
    () => target(base, "activity", "/activity", "/activity"),
    [base],
  );
  const assistant = useMemo(
    () => target(base, "assistant", "/assistant", "/assistant"),
    [base],
  );
  // Chat resumes by channel, so it has no route key.
  const chat = useMemo(() => target(base, "chat", "/chat"), [base]);
  const docs = useMemo(
    () => target(base, "docs", "/documents", "/documents"),
    [base],
  );
  const prewarm = useMemo(() => [chat, docs], [chat, docs]);
  usePrewarmSections(propertyId, userId, prewarm);

  return (
    <SidebarGroup className="pt-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <NavNode
            item={inbox}
            label="Inbox"
            icon={InboxIcon}
            count={unseenCount}
            navigate={navigate}
          >
            <Suspense fallback={null}>
              <ActivitySection propertyId={propertyId} userId={userId} />
            </Suspense>
          </NavNode>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={`${base}/my-tasks`} />}
              isActive={pathname.startsWith(`${base}/my-tasks`)}
              tooltip="My tasks"
            >
              <MyTasksIcon />
              <span className="flex-1">My tasks</span>
              {dueMine > 0 ? (
                <span
                  title="Due today or overdue"
                  className="shrink-0 text-xs font-medium text-faint-foreground tabular-nums"
                >
                  {dueMine > 99 ? "99+" : dueMine}
                </span>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <NavNode
            item={assistant}
            label="Assistant"
            icon={NewIcon}
            navigate={navigate}
          >
            <Suspense fallback={null}>
              <AssistantSection propertyId={propertyId} />
            </Suspense>
          </NavNode>
          <NavNode item={chat} label="Chat" icon={MessagesSquare} navigate={navigate}>
            <ChatSection
              propertyId={propertyId}
              userId={userId}
              isChannelAdmin={isManagement}
            />
          </NavNode>
          <NavNode item={docs} label="Docs" icon={FileText} navigate={navigate}>
            <DocumentsTreeSection propertyId={propertyId} />
          </NavNode>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const FAVORITES_OPEN_KEY = "hotelclaw:favorites-open";

/**
 * Starred docs as their own group (Linear's Favorites sits between Workspace
 * and Your teams). The label toggles the list; the group hides entirely when
 * nothing is starred, so an empty workspace doesn't carry a dead heading.
 */
export function FavoritesGroup({ propertyId }: { propertyId: string }) {
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
  const [open, toggle] = useStoredToggle(FAVORITES_OPEN_KEY, true);

  if (favorites.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        render={<button type="button" />}
        onClick={toggle}
        aria-expanded={open}
        className="w-full cursor-pointer rounded-md hover:bg-sidebar-accent"
      >
        <span className="flex-1 text-left">Favorites</span>
      </SidebarGroupLabel>
      <SidebarGroupAction
        onClick={toggle}
        aria-label={open ? "Collapse favorites" : "Expand favorites"}
      >
        <ChevronRight
          className={cn("transition-transform", open && "rotate-90")}
        />
      </SidebarGroupAction>
      {open ? (
        <SidebarGroupContent>
          <SidebarMenu>
            {favorites.map((d) => (
              <SidebarMenuItem key={d.id}>
                <SidebarMenuButton
                  render={<button type="button" />}
                  onClick={() => openDocument(d.id)}
                  isActive={pathname.includes(`/documents/${d.id}`)}
                  tooltip={d.title || "Untitled"}
                >
                  <FileText />
                  <span>{d.title || "Untitled"}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}

/**
 * The one "create anything" entry, beside Search at the top of the sidebar
 * (gr8r's top-bar "New ▾"). Each item reuses the create flow its own section
 * already owns — no second implementation of any of them.
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
