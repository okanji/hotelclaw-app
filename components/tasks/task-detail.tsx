"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useThreads } from "@liveblocks/react/suspense";
import { Composer, Thread } from "@liveblocks/react-ui";
import "@liveblocks/react-ui/styles.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { updateTask } from "./actions";
import { PresenceBar } from "./presence-bar";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  dueAt: string | null;
};

const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "in_progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

const PRIORITIES: { id: TaskPriority; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
];

export function TaskDetail({
  propertyId,
  task,
}: {
  propertyId: string;
  task: Task;
}) {
  const { threads } = useThreads();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateTask({
        taskId: task.id,
        title,
        description: description || null,
        status,
        priority,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Saved");
      }
    });
  }

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_360px]">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href={`/p/${propertyId}/tasks`} />}
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
          </div>
          <PresenceBar />
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
          />
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" />}
              >
                Status: {status.replace("_", " ")}
                <ChevronDown className="size-4 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => setStatus(s.id)}
                  >
                    {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="capitalize"
                  />
                }
              >
                Priority: {priority}
                <ChevronDown className="size-4 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {PRIORITIES.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setPriority(p.id)}
                  >
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Textarea
            placeholder="Add a description…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[160px]"
          />
          <div>
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
      <aside className="flex h-full min-h-0 flex-col border-l bg-muted/20">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Comments</h2>
          <p className="text-xs text-muted-foreground">
            Real-time discussion on this task.
          </p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {threads.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              No comments yet.
            </p>
          ) : (
            threads.map((thread) => (
              <Thread key={thread.id} thread={thread} />
            ))
          )}
        </div>
        <div className="border-t p-3">
          <Composer metadata={{ taskId: task.id }} />
        </div>
      </aside>
    </div>
  );
}
