"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, MoreHorizontal } from "lucide-react";
import { updateTask, deleteTask } from "./actions";
import { toast } from "sonner";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

type Props = {
  propertyId: string;
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_at: string | null;
  };
  onChanged: () => void;
};

const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "in_progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

const PRIORITY_VARIANT: Record<TaskPriority, "default" | "secondary" | "destructive" | "outline"> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  urgent: "destructive",
};

export function TaskCard({ propertyId, task, onChanged }: Props) {
  const [pending, startTransition] = useTransition();

  function changeStatus(status: TaskStatus) {
    startTransition(async () => {
      const result = await updateTask({ taskId: task.id, status });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        onChanged();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Task deleted");
        onChanged();
      }
    });
  }

  return (
    <div className="group rounded-md border bg-background p-3 shadow-xs transition hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/p/${propertyId}/tasks/${task.id}`}
          className="text-sm font-medium leading-snug hover:underline"
        >
          {task.title}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="size-6 opacity-0 transition group-hover:opacity-100"
                disabled={pending}
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              {STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  disabled={s.id === task.status}
                  onClick={() => changeStatus(s.id)}
                >
                  {s.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={remove}
                className="text-destructive focus:text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={PRIORITY_VARIANT[task.priority]} className="capitalize">
          {task.priority}
        </Badge>
        {task.due_at ? (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3" />
            {new Date(task.due_at).toLocaleDateString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
