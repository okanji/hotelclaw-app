import { z } from "zod";
import { type StepCatalogEntry } from "./types";
import { explainCondition, humanizeRef } from "@/lib/workflows/explain-expr";

const actions: StepCatalogEntry[] = [
  {
    id: "control.filter",
    surface: "control",
    category: "control",
    label: "Continue only if…",
    description:
      "Checks a condition against earlier data. If it isn't met, the workflow quietly stops here — no error, nothing after this runs.",
    examplePrompts: [
      "only continue if the priority is high",
      "stop if the channel isn't #front-desk",
    ],
    outputSchema: z.object({ passed: z.boolean() }),
    explain: (config) => {
      const expr = (config as { expr?: unknown } | undefined)?.expr;
      return expr === undefined
        ? "Set a condition to filter on →"
        : `Only continue if ${explainCondition(expr)}`;
    },
  },
  {
    id: "control.branch_if",
    surface: "control",
    category: "control",
    label: "If / else",
    description:
      "Splits the workflow in two. When your condition is met, the steps on the “Then” path run; otherwise the “Else” path runs.",
    examplePrompts: ["if urgent then... else...", "branch on priority"],
    outputSchema: z.object({ branch: z.enum(["true", "false"]) }),
    explain: (config) => {
      const expr = (config as { expr?: unknown } | undefined)?.expr;
      return expr === undefined ? "Set a condition →" : `If ${explainCondition(expr)}`;
    },
  },
  {
    id: "control.branch_switch",
    surface: "control",
    category: "control",
    label: "Route by value",
    description:
      "Sends the workflow down a different path for each value of a field — with a catch-all path for anything that doesn't match.",
    examplePrompts: ["route by severity", "switch on the classifier label"],
    outputSchema: z.object({ branch: z.string() }),
    explain: (config) => {
      const input = (config as { input?: string } | undefined)?.input;
      return input ? `Route by ${humanizeRef(input)}` : "Route by a value";
    },
  },
  {
    id: "control.delay",
    surface: "control",
    category: "control",
    label: "Wait a while",
    description:
      "Pauses the workflow for a set amount of time (e.g. 30 minutes, 2 hours, 1 day) before continuing.",
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
    label: "Wait for something to happen",
    description:
      "Pauses until a matching event arrives (like a task being marked done), with an optional time limit to give up.",
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
    label: "Repeat for each item",
    description:
      "Runs the steps inside it once for each item in a list — handy for acting on every action item, room, or guest.",
    examplePrompts: ["for each action item, create a task", "loop over the rooms"],
    outputSchema: z.object({ iterations: z.number() }),
    explain: () => "Repeat for each item",
  },
  {
    id: "control.parallel",
    surface: "control",
    category: "control",
    label: "Do several things at once",
    description:
      "Runs several branches at the same time, then waits — either for all of them to finish, or just for the first one.",
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
      "Ends the workflow here. You can add an outcome label that shows up in run history.",
    examplePrompts: ["end the workflow"],
    outputSchema: z.object({ outcome: z.string().optional() }),
    explain: (config) => {
      const c = config as { outcome?: string };
      return c.outcome ? `End: ${c.outcome}` : "End";
    },
  },
];

export const CONTROL_ACTIONS = actions;
