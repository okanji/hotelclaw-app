"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { createTask } from "./actions";
import type { TaskPriority } from "@/lib/db/types";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

const PRIORITIES: { id: TaskPriority; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
];

export function CreateTaskDialog({
  propertyId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createTask({
        propertyId,
        title,
        description: description || undefined,
        priority,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Task created");
      setTitle("");
      setDescription("");
      setPriority("medium");
      onOpenChange(false);
      onCreated();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Tasks are visible to everyone in the property.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              autoFocus
              required
              placeholder="Restock minibar in 304"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              rows={3}
              placeholder="Optional details…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-between capitalize"
                    disabled={pending}
                  />
                }
              >
                {priority}
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
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
