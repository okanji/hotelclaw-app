import { z } from "zod";
import { explainTriggerFilter } from "@/lib/workflows/trigger-filter";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

function explainTaskTrigger(
  eventType: string,
  defaultPhrase: string,
  filter?: unknown,
): string {
  return explainTriggerFilter(eventType, filter, defaultPhrase);
}

// ─── Triggers ────────────────────────────────────────────────────────────────

const triggers: TriggerCatalogEntry[] = [
  {
    id: "task.created",
    surface: "tasks",
    category: "trigger",
    label: "When a task is created",
    description:
      "Runs whenever a task is created in this property. Use the filters below to narrow it down (for example, only tasks with a certain label). The new task's details are available to later steps.",
    examplePrompts: [
      "when a task is created with label 'guest-complaint'",
      "every time someone creates a high-priority task",
      "whenever a new maintenance task appears",
    ],
    outputSchema: z.object({ new: z.record(z.string(), z.unknown()) }),
    explain: (filter) => explainTaskTrigger("task.created", "When a task is created", filter),
  },
  {
    id: "task.status_changed",
    surface: "tasks",
    category: "trigger",
    label: "When a task’s status changes",
    description:
      "Fires when a task's status changes. You get the old and new status plus the full task — handy for reacting when something moves to ‘blocked’ or ‘done’.",
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
    explain: (filter) =>
      explainTaskTrigger("task.status_changed", "When a task changes status", filter),
  },
  {
    id: "task.assigned",
    surface: "tasks",
    category: "trigger",
    label: "When a task is assigned",
    description:
      "Fires when a task is assigned or reassigned. You get who it moved from and to, along with the task itself.",
    examplePrompts: [
      "when a task is assigned to me",
      "whenever a task gets reassigned",
    ],
    outputSchema: z.object({
      from: z.string().nullable(),
      to: z.string().nullable(),
      new: z.record(z.string(), z.unknown()),
    }),
    explain: (filter) => explainTaskTrigger("task.assigned", "When a task is assigned", filter),
  },
  {
    id: "task.overdue",
    surface: "tasks",
    category: "trigger",
    label: "When a task becomes overdue",
    description:
      "Runs once per task when its due date passes without the task being marked done.",
    examplePrompts: [
      "when a task becomes overdue",
      "every time a task passes its due date",
    ],
    outputSchema: z.object({ new: z.record(z.string(), z.unknown()) }),
    explain: (filter) => explainTaskTrigger("task.overdue", "When a task is overdue", filter),
  },
  {
    id: "task.label_added",
    surface: "tasks",
    category: "trigger",
    label: "When a label is added to a task",
    description:
      "Fires when labels are added to a task. You get which labels were added plus the full task (title, description, priority, etc.) for later steps.",
    examplePrompts: [
      "when the 'vip' label is added to a task",
      "whenever a task gets labeled 'urgent'",
    ],
    outputSchema: z.object({
      added_labels: z.array(z.string()),
      new: z.record(z.string(), z.unknown()),
    }),
    explain: (filter) =>
      explainTaskTrigger("task.label_added", "When a label is added to a task", filter),
  },
  {
    id: "task.added_to_space",
    surface: "tasks",
    category: "trigger",
    label: "When a task is added to a team",
    description:
      "Fires when a task's team (department) is set or changed — e.g. moved into F&B or Maintenance. You get the previous and new team plus the full task.",
    examplePrompts: [
      "when a task is added to the Maintenance team",
      "whenever a task moves into a different department",
    ],
    outputSchema: z.object({
      from: z.string().nullable(),
      to: z.string().nullable(),
      new: z.record(z.string(), z.unknown()),
    }),
    explain: (filter) =>
      explainTaskTrigger("task.added_to_space", "When a task is added to a team", filter),
  },
  {
    id: "task.added_to_project",
    surface: "tasks",
    category: "trigger",
    label: "When a task is added to a project",
    description:
      "Fires when a task's project (a cross-space initiative like a Wedding or Festival) is set or changed. You get the previous and new project plus the full task.",
    examplePrompts: [
      "when a task is added to the Wedding project",
      "whenever a task moves to a different project",
    ],
    outputSchema: z.object({
      from: z.string().nullable(),
      to: z.string().nullable(),
      new: z.record(z.string(), z.unknown()),
    }),
    explain: (filter) =>
      explainTaskTrigger("task.added_to_project", "When a task is added to a project", filter),
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
      "Creates a new task. Only the title is required; everything else is optional, and you can fill fields with data from earlier steps. Later steps can use the created task.",
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
      "Changes fields on an existing task — status, priority, assignee, and more. Pick the task, then set whatever you want to change.",
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
      "Assigns a task to someone. Pick the task and who it should go to — both can come from earlier steps.",
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
      "Adds a single label to a task. Adding a label that's already there does nothing.",
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
