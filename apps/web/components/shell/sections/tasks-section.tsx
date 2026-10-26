"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  IterationCw,
  List,
  ListFilter,
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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  triageCountQueryOptions,
  useTriageRealtime,
} from "@/lib/query/triage-queries";
import {
  cycleScopes,
  cyclesQueryOptions,
} from "@/lib/query/cycle-queries";
import { spacesQueryOptions, type SpaceRow } from "@/lib/query/project-queries";
import {
  useStatusCatalog,
  useStatusCatalogRealtime,
} from "@/lib/query/status-queries";
import { LABEL_DOT, LABEL_INK } from "@/components/labels/label-tokens";
import { useStoredToggle } from "@/components/shell/use-stored-toggle";
import { CreateListDialog } from "@/components/tasks/lists/create-list-dialog";
import type { ListRow } from "@/lib/tasks/statuses";

/**
 * The Tasks node's children: Linear's team planning rows — Triage (the
 * intake queue, with its pending count) and Cycles (plus the current cycle
 * of each cadence) — followed by the **Lists** tree (0114, ClickUp's
 * Space → Folder → List): the property-level lists first, then each
 * top-level team (sub-teams nested by `parent_space_id`) folding open to its
 * lists. A list row opens the board scoped to it (`?list=`), which swaps the
 * columns to that list's pipeline. The Tasks row itself opens the whole
 * board; team and project scoping also live in the board's Filter and the
 * Teams / Projects groups.
 */
export function TasksSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Live pending count; the realtime hook keeps it (and the queue) fresh.
  useTriageRealtime(propertyId);
  const { data: triageCount = 0 } = useQuery(triageCountQueryOptions(propertyId));
  const triageHref = `/p/${propertyId}/triage`;

  // One "current cycle" row per enabled cadence (property-wide first).
  const { data: scopes = [] } = useQuery({
    ...cyclesQueryOptions(propertyId),
    select: cycleScopes,
  });
  const cyclesBase = `/p/${propertyId}/cycles`;
  const cycleId = pathname.match(/\/cycles\/([^/?]+)/)?.[1];

  // Lists tree.
  useStatusCatalogRealtime(propertyId);
  const catalog = useStatusCatalog(propertyId);
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const [listsOpen, toggleLists] = useStoredToggle("hotelclaw:lists-open", true);
  const [expanded, toggleExpanded] = useExpandedSpaces();
  const [dialog, setDialog] = useState<{
    open: boolean;
    spaceId: string | null;
    spaceName: string | null;
  }>({ open: false, spaceId: null, spaceName: null });

  const onBoard = pathname === `/p/${propertyId}/tasks`;
  const activeList = onBoard ? searchParams.get("list") : null;
  const activeSpace = onBoard ? searchParams.get("space") : null;
  const boardHref = `/p/${propertyId}/tasks`;

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, SpaceRow[]>();
    for (const s of spaces) {
      const arr = map.get(s.parent_space_id) ?? [];
      arr.push(s);
      map.set(s.parent_space_id, arr);
    }
    return map;
  }, [spaces]);

  const propertyLists = catalog.listsOfSpace(null);

  function renderSpace(space: SpaceRow, depth: number): React.ReactNode {
    const lists = catalog.listsOfSpace(space.id);
    const subs = childrenOf.get(space.id) ?? [];
    // A team whose lists hold the active one shows them, so "you are here"
    // is visible without a stored toggle.
    const holdsActive =
      lists.some((l) => l.id === activeList) || activeSpace === space.id;
    const open = expanded.has(space.id) || holdsActive;
    // Same anatomy as the Teams group rows: the label navigates (the board
    // scoped to the team), the trailing chevron folds the team's lists, and
    // a "+ New list" sub-row ends the fold (ClickUp's "+ List" under a Space).
    return (
      <SidebarMenuItem key={space.id}>
        <SidebarMenuButton
          render={<Link href={`${boardHref}?space=${space.id}`} />}
          isActive={activeSpace === space.id}
          tooltip={space.name}
          className="pr-7"
          style={depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined}
        >
          {space.icon ? (
            <span aria-hidden="true">{space.icon}</span>
          ) : (
            <Users className={LABEL_INK[space.color]} />
          )}
          <span className="truncate">{space.name}</span>
          {!open && lists.length > 0 ? (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-faint-foreground">
              {lists.length}
            </span>
          ) : null}
        </SidebarMenuButton>
        <SidebarMenuAction
          onClick={() => toggleExpanded(space.id)}
          aria-label={open ? `Collapse ${space.name}` : `Expand ${space.name}`}
          aria-expanded={open}
          disabled={holdsActive}
        >
          <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
        </SidebarMenuAction>
        {open ? (
          <SidebarMenuSub>
            {lists.map((l) => (
              <ListSubRow
                key={l.id}
                list={l}
                href={`${boardHref}?list=${l.id}`}
                active={activeList === l.id}
              />
            ))}
            {subs.map((s) => renderSpace(s, depth + 1))}
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                render={<button type="button" />}
                onClick={() =>
                  setDialog({ open: true, spaceId: space.id, spaceName: space.name })
                }
                className="text-muted-foreground"
              >
                <Plus />
                <span>New list</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        ) : null}
      </SidebarMenuItem>
    );
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={triageHref} />}
                isActive={pathname.startsWith(triageHref)}
                tooltip="Triage"
              >
                <ListFilter />
                <span className="flex-1">Triage</span>
                {triageCount > 0 ? (
                  <span className="shrink-0 text-xs font-medium tabular-nums text-faint-foreground">
                    {triageCount > 99 ? "99+" : triageCount}
                  </span>
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={cyclesBase} />}
                isActive={pathname === cyclesBase}
                tooltip="Cycles"
              >
                <IterationCw />
                <span>Cycles</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {scopes
              .filter((s) => s.current)
              .map((s) => (
                <SidebarMenuItem key={s.spaceId ?? "property"}>
                  <SidebarMenuButton
                    render={<Link href={`${cyclesBase}/${s.current!.id}`} />}
                    isActive={cycleId === s.current!.id}
                    tooltip="Current cycle"
                    className="pl-8 text-[13px]"
                  >
                    <span className="truncate">
                      {s.current!.name ?? `Cycle ${s.current!.number}`}
                      {scopes.length > 1 ? (
                        <span className="text-faint-foreground"> · current</span>
                      ) : null}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel
          render={<button type="button" />}
          onClick={toggleLists}
          aria-expanded={listsOpen}
          className="group/toggle w-[calc(100%-2rem)] cursor-pointer rounded-md hover:bg-sidebar-accent"
        >
          <span className="text-left">Lists</span>
          <ChevronRight
            className={cn(
              "opacity-0 transition-[transform,opacity] group-hover/toggle:opacity-100",
              listsOpen && "rotate-90",
              !listsOpen && "opacity-100",
            )}
          />
        </SidebarGroupLabel>
        <SidebarGroupAction
          title="New list"
          onClick={() => setDialog({ open: true, spaceId: null, spaceName: null })}
        >
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent className={cn(!listsOpen && "hidden")}>
          <SidebarMenu>
            {propertyLists.map((l) => (
              <SidebarMenuItem key={l.id}>
                <SidebarMenuButton
                  render={<Link href={`${boardHref}?list=${l.id}`} />}
                  isActive={activeList === l.id}
                  tooltip={l.name}
                >
                  <ListGlyph list={l} />
                  <span className="truncate">{l.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {(childrenOf.get(null) ?? []).map((s) => renderSpace(s, 0))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <CreateListDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        propertyId={propertyId}
        spaceId={dialog.spaceId}
        spaceName={dialog.spaceName}
      />
    </>
  );
}

function ListGlyph({ list }: { list: ListRow }) {
  if (list.icon) return <span aria-hidden="true">{list.icon}</span>;
  return <List className={LABEL_INK[list.color]} />;
}

function ListSubRow({
  list,
  href,
  active,
}: {
  list: ListRow;
  href: string;
  active: boolean;
}) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton render={<Link href={href} />} isActive={active}>
        {list.icon ? (
          <span aria-hidden="true">{list.icon}</span>
        ) : (
          <span
            className={cn("size-2 shrink-0 rounded-[3px]", LABEL_DOT[list.color])}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{list.name}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

const EXPANDED_KEY = "hotelclaw:lists-expanded";

/** Which team rows of the Lists tree are open — remembered per browser. */
function useExpandedSpaces(): [Set<string>, (id: string) => void] {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Storage unavailable — rows just start collapsed.
    }
  }, []);
  const toggle = (id: string) =>
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // Preference only.
      }
      return next;
    });
  return [ids, toggle];
}
