import { z } from "zod";
import { type StepCatalogEntry } from "./types";

const actions: StepCatalogEntry[] = [
  {
    id: "control.filter",
    surface: "control",
    category: "control",
    label: "Filter (stop if predicate is false)",
    description:
      "Evaluate a JSONLogic predicate against upstream variables. If false, the run is marked `filtered` and stops here without error.",
    examplePrompts: [
      "only continue if the priority is high",
      "stop if the channel isn't #front-desk",
    ],
    outputSchema: z.object({ passed: z.boolean() }),
    explain: () => "Filter (stop if condition fails)",
  },
  {
    id: "control.branch_if",
    surface: "control",
    category: "control",
    label: "Branch (if/else)",
    description:
      "Evaluate a JSONLogic predicate; route into `branches.true` or `branches.false` based on the result.",
    examplePrompts: ["if urgent then... else...", "branch on priority"],
    outputSchema: z.object({ branch: z.enum(["true", "false"]) }),
    explain: () => "Branch (if/else)",
  },
  {
    id: "control.branch_switch",
    surface: "control",
    category: "control",
    label: "Branch (switch on value)",
    description:
      "Look up a value (from `input`) in `branches` (a map of value → next step id). Falls back to `branches._default` if no match.",
    examplePrompts: ["route by severity", "switch on the classifier label"],
    outputSchema: z.object({ branch: z.string() }),
    explain: () => "Branch (switch on value)",
  },
  {
    id: "control.delay",
    surface: "control",
    category: "control",
    label: "Delay",
    description:
      "Pause execution for a fixed duration (e.g. '30m', '2h', '1d'). Promotes the workflow to durable mode automatically.",
    examplePrompts: ["wait 30 minutes", "delay 2 hours"],
    outputSchema: z.object({ slept_for: z.string() }),
    explain: (config) => {
      const c = config as { duration?: string };
      return `Wait ${c.duration ?? "..."}`;
    },
  },
  {
    id: "control.wait_for_event",
    surface: "control",
    category: "control",
    label: "Wait for event",
    description:
      "Pause until a matching event arrives (correlated by id), with an optional timeout. Promotes the workflow to durable mode.",
    examplePrompts: [
      "wait for the task to be marked done",
      "wait for the manager to reply in the thread",
    ],
    outputSchema: z.object({
      received: z.boolean(),
      event: z.record(z.string(), z.unknown()).optional(),
    }),
    explain: (config) => {
      const c = config as { event_type?: string };
      return c.event_type ? `Wait for ${c.event_type}` : "Wait for event";
    },
  },
  {
    id: "control.foreach",
    surface: "control",
    category: "control",
    label: "For each item in collection",
    description:
      "Iterate over an array variable. Each iteration runs the sub-flow starting at `body_start` with `item_var` set to the current item.",
    examplePrompts: ["for each action item, create a task", "loop over the rooms"],
    outputSchema: z.object({ iterations: z.number() }),
    explain: () => "For each item in collection",
  },
  {
    id: "control.parallel",
    surface: "control",
    category: "control",
    label: "Run in parallel",
    description:
      "Fan out to multiple branches in parallel, then join. `join: 'all'` waits for all branches; `'any'` continues on the first to finish.",
    examplePrompts: ["do these three things in parallel"],
    outputSchema: z.object({ completed: z.array(z.string()) }),
    explain: () => "Run branches in parallel",
  },
  {
    id: "control.end",
    surface: "control",
    category: "control",
    label: "End",
    description:
      "Terminate the workflow. Optional `outcome` label is recorded for analytics.",
    examplePrompts: ["end the workflow"],
    outputSchema: z.object({ outcome: z.string().optional() }),
    explain: (config) => {
      const c = config as { outcome?: string };
      return c.outcome ? `End: ${c.outcome}` : "End";
    },
  },
];

export const CONTROL_ACTIONS = actions;
