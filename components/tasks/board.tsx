"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBroadcastEvent, useEventListener } from "@liveblocks/react/suspense";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TaskCard } from "./task-card";
import { CreateTaskDialog } from "./create-task-dialog";
import { PresenceBar } from "./presence-bar";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_at: string | null;
  updated_at: string;
};

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "in_progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

export function TasksBoard({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const broadcast = useBroadcastEvent();

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["tasks", propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/tasks`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load tasks");
      return res.json();
    },
  });

  useEventListener(({ event }) => {
    if (event.type === "tasks-invalidate") {
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    }
    if (event.type === "task-invalidate") {
      qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    }
  });

  function notifyChanged() {
    broadcast({ type: "tasks-invalidate" });
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b bg-background/60 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-base font-semibold">Tasks</h1>
          <p className="text-xs text-muted-foreground">
            Real-time across the property.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PresenceBar />
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New task
          </Button>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-x-auto p-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              className="flex min-w-[260px] flex-col rounded-lg border bg-muted/30"
            >
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="text-sm font-medium">{col.label}</div>
                <div className="text-xs text-muted-foreground">
                  {columnTasks.length}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading…</div>
                ) : columnTasks.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                    Empty
                  </div>
                ) : (
                  columnTasks.map((t) => (
                    <TaskCard
                      key={t.id}
                      propertyId={propertyId}
                      task={t}
                      onChanged={notifyChanged}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      <CreateTaskDialog
        propertyId={propertyId}
        open={open}
        onOpenChange={setOpen}
        onCreated={notifyChanged}
      />
    </div>
  );
}
