import { z } from "zod";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

// ─── Triggers ────────────────────────────────────────────────────────────────

const triggers: TriggerCatalogEntry[] = [
  {
    id: "task.created",
    surface: "tasks",
    category: "trigger",
    label: "Task created",
    description:
      "Fires when any task is created in this property. Filter by label, project, priority, or assignee to scope it. Trigger payload exposes the new task at {{trigger.new}}.",
    examplePrompts: [
      "when a task is created with label 'guest-complaint'",
      "every time someone creates a high-priority task",
      "whenever a new maintenance task appears",
    ],
    outputSchema: z.object({ new: z.record(z.string(), z.unknown()) }),
    explain: () => "When a task is created",
  },
  {
    id: "task.status_changed",
    surface: "tasks",
    category: "trigger",
    label: "Task status changed",
    description:
      "Fires when a task's status changes. Payload includes {{trigger.from}} and {{trigger.to}} alongside the full {{trigger.new}} row. Common filters: to 'blocked', to 'done'.",
    examplePrompts: [
      "when a task is moved to blocked",
      "every time a task is completed",
      "when a task moves from in_progress to done",
    ],
    outputSchema: z.object({
      from: z.string(),
      to: z.string(),
      new: z.record(z.string(), z.unknown()),
    }),
    explain: () => "When a task changes status",
  },
  {
    id: "task.assigned",
    surface: "tasks",
    category: "trigger",
    label: "Task assigned",
    description:
      "Fires when a task is assigned to (or reassigned to) someone. Payload has {{trigger.from}}, {{trigger.to}} (user ids) and the task at {{trigger.new}}.",
    examplePrompts: [
      "when a task is assigned to me",
      "whenever a task gets reassigned",
    ],
    outputSchema: z.object({
      from: z.string().nullable(),
      to: z.string().nullable(),
      new: z.record(z.string(), z.unknown()),
    }),
    explain: () => "When a task is assigned",
  },
  {
    id: "task.overdue",
    surface: "tasks",
    category: "trigger",
    label: "Task became overdue",
    description:
      "Fires once per task when its due_at passes without the task being marked done. Driven by a per-property cron sweep.",
    examplePrompts: [
      "when a task becomes overdue",
      "every time a task passes its due date",
    ],
    outputSchema: z.object({ new: z.record(z.string(), z.unknown()) }),
    explain: () => "When a task is overdue",
  },
  {
    id: "task.label_added",
    surface: "tasks",
    category: "trigger",
    label: "Label added to task",
    description:
      "Fires when one or more labels are added to a task. Payload exposes {{trigger.added_labels}} (array) and the full task. Filter to a specific label using a predicate.",
    examplePrompts: [
      "when the 'vip' label is added to a task",
      "whenever a task gets labeled 'urgent'",
    ],
    outputSchema: z.object({
      added_labels: z.array(z.string()),
      new: z.record(z.string(), z.unknown()),
    }),
    explain: () => "When a label is added to a task",
  },
];

// ─── Actions ─────────────────────────────────────────────────────────────────

const actions: StepCatalogEntry[] = [
  {
    id: "action.task.create",
    surface: "tasks",
    category: "action",
    label: "Create task",
    description:
      "Create a new task. Title is required; everything else is optional. Use {{...}} refs to pull values from upstream steps. Returns the created task at {{steps.<id>.output.task}}.",
    examplePrompts: [
      "create a task titled 'follow up with guest'",
      "make a new task and assign it to the manager",
    ],
    outputSchema: z.object({ task: z.record(z.string(), z.unknown()) }),
    explain: (config) => {
      const c = config as { title?: string };
      return `Create task${c.title ? `: "${c.title}"` : ""}`;
    },
  },
  {
    id: "action.task.update",
    surface: "tasks",
    category: "action",
    label: "Update task",
    description:
      "Patch fields on an existing task. Pass task_id (required) plus any subset of fields. Returns the updated task.",
    examplePrompts: [
      "update the task status to in_progress",
      "set the priority to urgent",
    ],
    outputSchema: z.object({ task: z.record(z.string(), z.unknown()) }),
    explain: () => "Update task fields",
  },
  {
    id: "action.task.assign",
    surface: "tasks",
    category: "action",
    label: "Assign task",
    description:
      "Reassign a task to a user. Pass task_id and assignee_id (both required, both accept {{...}} refs).",
    examplePrompts: ["assign this task to the manager", "reassign to Eli"],
    outputSchema: z.object({ task: z.record(z.string(), z.unknown()) }),
    explain: () => "Assign task to a user",
  },
  {
    id: "action.task.add_label",
    surface: "tasks",
    category: "action",
    label: "Add label to task",
    description:
      "Add a single label to a task. Idempotent — adding an existing label is a no-op.",
    examplePrompts: ["add the 'escalated' label", "tag with 'follow-up'"],
    outputSchema: z.object({ task: z.record(z.string(), z.unknown()) }),
    explain: (config) => {
      const c = config as { label?: string };
      return `Add label${c.label ? ` "${c.label}"` : ""}`;
    },
  },
];

export const TASKS_TRIGGERS = triggers;
export const TASKS_ACTIONS = actions;
