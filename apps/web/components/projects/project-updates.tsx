"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UpdateHealth } from "@/lib/db/types";
import {
  projectUpdatesQueryOptions,
  type ProjectUpdate,
  type UpdateTarget,
} from "@/lib/query/initiative-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { activityTimeAgo, useViewerId } from "@/components/activity/activity-log";
import { HealthPicker, UpdateHealthBadge } from "@/components/initiatives/health";
import {
  deleteProjectUpdate,
  editProjectUpdate,
  postProjectUpdate,
} from "./update-actions";
import { OverviewSection } from "./workspace-shell";

/**
 * Keep every updates feed + the declared-health index live for the property.
 * One channel per mount; invalidation is by key prefix, so a post on a project
 * also refreshes the initiatives list's roll-up.
 */
export function useProjectUpdatesRealtime(propertyId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!propertyId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`project-updates:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_updates",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["project-updates"] });
          qc.invalidateQueries({ queryKey: ["update-health", propertyId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);
}

function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Linear's "Write project update": a collapsed prompt that opens into a health
 * call + free-text note. The newest update's health becomes the entity's
 * declared health everywhere it is shown.
 */
export function UpdateComposer({
  propertyId,
  target,
}: {
  propertyId: string;
  target: UpdateTarget;
}) {
  const qc = useQueryClient();
  const { data: updates = [] } = useQuery(projectUpdatesQueryOptions(target));
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<UpdateHealth>("on_track");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const first = updates.length === 0;
  const noun = target.kind === "project" ? "project" : "initiative";

  function openComposer() {
    // Seed the call from the last update — most updates restate it.
    if (updates[0]) setHealth(updates[0].health);
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const r = await postProjectUpdate({ target, health, body });
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      setBody("");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["project-updates", target.kind, target.id] });
      void qc.invalidateQueries({ queryKey: ["update-health", propertyId] });
      void qc.invalidateQueries({ queryKey: ["activity-log", propertyId] });
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openComposer}
        className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-muted-foreground shadow-ring transition-colors hover:bg-accent"
      >
        <Megaphone className="size-4 shrink-0 text-faint-foreground" />
        {first ? `Write first ${noun} update` : `Write ${noun} update`}
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2.5 rounded-md p-3 shadow-ring"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <HealthPicker value={health} onChange={setHealth} disabled={pending} />
      <Textarea
        autoFocus
        bare
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`What changed, what's next, what's in the way?`}
        aria-label="Update"
        className="min-h-20 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Post update
        </Button>
      </div>
    </form>
  );
}

function UpdateItem({
  update,
  author,
  mine,
  onChanged,
}: {
  update: ProjectUpdate;
  author: { name: string | null; avatarUrl: string | null } | undefined;
  mine: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [health, setHealth] = useState<UpdateHealth>(update.health);
  const [body, setBody] = useState(update.body);
  const [pending, startTransition] = useTransition();
  const edited = update.updated_at.slice(0, 19) !== update.created_at.slice(0, 19);

  function save() {
    startTransition(async () => {
      const r = await editProjectUpdate(update.id, { health, body });
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  }

  function remove() {
    if (!window.confirm("Delete this update?")) return;
    startTransition(async () => {
      const r = await deleteProjectUpdate(update.id);
      if ("error" in r) toast.error(r.error);
      onChanged();
    });
  }

  return (
    <li className="group/upd flex gap-3 border-t border-border py-4 first:border-0 first:pt-0">
      <Avatar className="size-6 shrink-0">
        {author?.avatarUrl ? <AvatarImage src={author.avatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-accent-pressed text-[11px] font-medium text-secondary-ink">
          {initials(author?.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-foreground">
            {author?.name ?? "Former member"}
          </span>
          <UpdateHealthBadge health={update.health} />
          <time
            dateTime={update.created_at}
            title={new Date(update.created_at).toLocaleString()}
            className="text-xs tabular-nums text-faint-foreground"
          >
            {activityTimeAgo(update.created_at)}
            {edited ? " · edited" : ""}
          </time>
          {mine && !editing ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Update actions"
                    className="ml-auto opacity-0 transition-opacity group-hover/upd:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6}>
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil className="size-3.5" />
                  <span className="flex-1">Edit</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={remove}>
                  <Trash2 className="size-3.5" />
                  <span className="flex-1">Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <HealthPicker value={health} onChange={setHealth} disabled={pending} />
            <Textarea
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Edit update"
              className="text-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setHealth(update.health);
                  setBody(update.body);
                }}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={pending} onClick={save}>
                Save
              </Button>
            </div>
          </div>
        ) : update.body ? (
          <p className="text-sm leading-6 whitespace-pre-wrap text-foreground">{update.body}</p>
        ) : null}
      </div>
    </li>
  );
}

/** The updates feed, newest first. Authors can edit / delete their own. */
export function UpdatesFeed({
  propertyId,
  target,
  limit,
}: {
  propertyId: string;
  target: UpdateTarget;
  /** Show only the newest N (the rest behind "Show all"). */
  limit?: number;
}) {
  const qc = useQueryClient();
  const meId = useViewerId();
  const { data: updates = [], isPending } = useQuery(projectUpdatesQueryOptions(target));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const [showAll, setShowAll] = useState(false);

  if (isPending) return <p className="text-sm text-muted-foreground">Loading updates…</p>;
  if (updates.length === 0) return null;

  const shown = limit && !showAll ? updates.slice(0, limit) : updates;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["project-updates", target.kind, target.id] });
    void qc.invalidateQueries({ queryKey: ["update-health", propertyId] });
  };

  return (
    <div className="flex flex-col">
      <ul role="list" className="flex flex-col">
        {shown.map((u) => (
          <UpdateItem
            key={`${u.id}:${u.updated_at}`}
            update={u}
            author={u.author_id ? byId.get(u.author_id) : undefined}
            mine={Boolean(meId && u.author_id === meId)}
            onChanged={refresh}
          />
        ))}
      </ul>
      {limit && updates.length > limit ? (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className={cn(
            "self-start rounded-md px-1.5 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          )}
        >
          {showAll ? "Show fewer" : `Show all ${updates.length} updates`}
        </button>
      ) : null}
    </div>
  );
}

/** Composer + feed under one Overview heading — the project & initiative pages. */
export function UpdatesSection({
  propertyId,
  target,
}: {
  propertyId: string;
  target: UpdateTarget;
}) {
  useProjectUpdatesRealtime(propertyId);
  return (
    <OverviewSection title="Updates">
      <UpdateComposer propertyId={propertyId} target={target} />
      <UpdatesFeed propertyId={propertyId} target={target} limit={3} />
    </OverviewSection>
  );
}
