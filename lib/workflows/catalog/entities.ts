import { z } from "zod";
import { type StepCatalogEntry, type TriggerCatalogEntry } from "./types";

// Workflow-defined entities are the hotel-domain primitive: users declare ad-hoc
// "entity types" (room, guest, booking) via a JSON Schema, and workflows can
// react to and act on them. The AI authoring bot can also propose new entity
// types during authoring via the `propose_entity_type` tool.

const triggers: TriggerCatalogEntry[] = [
  {
    id: "entity.created",
    surface: "entities",
    category: "trigger",
    label: "Entity created",
    description:
      "Fires when a new entity is created. Narrow it to one type (e.g. ‘room’ or ‘guest’); the new entity's details are available to later steps.",
    examplePrompts: [
      "when a new room is added",
      "every time a guest is checked in",
      "when a new booking is created",
    ],
    outputSchema: z.object({
      new: z.record(z.string(), z.unknown()),
      type: z.string(),
    }),
    explain: (filter) => {
      const f = (filter as { entity_type?: string }) ?? {};
      return f.entity_type ? `When a new ${f.entity_type} is created` : "When an entity is created";
    },
  },
  {
    id: "entity.field_changed",
    surface: "entities",
    category: "trigger",
    label: "Entity field changed",
    description:
      "Fires when an entity row is updated. Narrow it to a specific entity type and, optionally, a specific field with a condition (e.g. status changes to ‘maintenance_needed’).",
    examplePrompts: [
      "when a room status changes to maintenance_needed",
      "when a guest's preferences are updated",
    ],
    outputSchema: z.object({
      old: z.record(z.string(), z.unknown()),
      new: z.record(z.string(), z.unknown()),
      type: z.string(),
    }),
    explain: (filter) => {
      const f = (filter as { entity_type?: string }) ?? {};
      return f.entity_type ? `When a ${f.entity_type} field changes` : "When an entity field changes";
    },
  },
];

const actions: StepCatalogEntry[] = [
  {
    id: "action.entity.create",
    surface: "entities",
    category: "action",
    label: "Create entity",
    description:
      "Creates a new entity of a given type (e.g. a room or guest) with the fields you set. Later steps can use it.",
    examplePrompts: ["create a new room entity", "register a guest"],
    outputSchema: z.object({ entity: z.record(z.string(), z.unknown()) }),
    explain: (config) => {
      const c = config as { entity_type?: string };
      return `Create ${c.entity_type ?? "entity"}`;
    },
  },
  {
    id: "action.entity.update",
    surface: "entities",
    category: "action",
    label: "Update entity",
    description:
      "Updates fields on an existing entity. Only the fields you set change; the rest stay as they are.",
    examplePrompts: ["mark the room as clean", "update the guest's room number"],
    outputSchema: z.object({ entity: z.record(z.string(), z.unknown()) }),
    explain: () => "Update entity fields",
  },
  {
    id: "action.entity.find",
    surface: "entities",
    category: "action",
    label: "Find entities",
    description:
      "Looks up entities of a given type that match the filters you set, and hands the matches to later steps. You can cap how many come back.",
    examplePrompts: [
      "find all rooms on the second floor",
      "look up the guest by room number",
    ],
    outputSchema: z.object({
      entities: z.array(z.record(z.string(), z.unknown())),
      count: z.number(),
    }),
    explain: (config) => {
      const c = config as { entity_type?: string };
      return `Find ${c.entity_type ?? "entities"}`;
    },
  },
  {
    id: "action.entity.delete",
    surface: "entities",
    category: "action",
    label: "Delete entity",
    description: "Permanently delete an entity row by id.",
    examplePrompts: ["delete this entity"],
    outputSchema: z.object({ ok: z.boolean() }),
    explain: () => "Delete entity",
  },
];

export const ENTITIES_TRIGGERS = triggers;
export const ENTITIES_ACTIONS = actions;
