import type { StepType, TriggerEventType } from "@/lib/workflows/spec";
import {
  type CatalogEntry,
  type StepCatalogEntry,
  type Surface,
  type TriggerCatalogEntry,
} from "./types";

import { TASKS_TRIGGERS, TASKS_ACTIONS } from "./tasks";
import { CHAT_TRIGGERS, CHAT_ACTIONS } from "./chat";
import { DOCS_TRIGGERS, DOCS_ACTIONS } from "./docs";
import { MEETINGS_TRIGGERS, MEETINGS_ACTIONS } from "./meetings";
import { CALENDAR_TRIGGERS } from "./calendar";
import { ENTITIES_TRIGGERS, ENTITIES_ACTIONS } from "./entities";
import { AI_ACTIONS } from "./ai";
import { CONTROL_ACTIONS } from "./control";
import { SYSTEM_TRIGGERS, SYSTEM_ACTIONS } from "./system";
import { EXTERNAL_ACTIONS } from "./external";

export const TRIGGERS: TriggerCatalogEntry[] = [
  ...TASKS_TRIGGERS,
  ...CHAT_TRIGGERS,
  ...DOCS_TRIGGERS,
  ...MEETINGS_TRIGGERS,
  ...CALENDAR_TRIGGERS,
  ...ENTITIES_TRIGGERS,
  ...SYSTEM_TRIGGERS,
];

export const STEPS: StepCatalogEntry[] = [
  ...TASKS_ACTIONS,
  ...CHAT_ACTIONS,
  ...DOCS_ACTIONS,
  ...MEETINGS_ACTIONS,
  ...ENTITIES_ACTIONS,
  ...AI_ACTIONS,
  ...CONTROL_ACTIONS,
  ...SYSTEM_ACTIONS,
  ...EXTERNAL_ACTIONS,
];

export const CATALOG: ReadonlyArray<CatalogEntry> = [...TRIGGERS, ...STEPS];

const TRIGGER_BY_ID = new Map<TriggerEventType, TriggerCatalogEntry>(
  TRIGGERS.map((t) => [t.id, t]),
);
const STEP_BY_ID = new Map<StepType, StepCatalogEntry>(STEPS.map((s) => [s.id, s]));

export function getTrigger(id: TriggerEventType): TriggerCatalogEntry | undefined {
  return TRIGGER_BY_ID.get(id);
}

export function getStep(id: StepType): StepCatalogEntry | undefined {
  return STEP_BY_ID.get(id);
}

export function triggersBySurface(surface?: Surface): TriggerCatalogEntry[] {
  return surface ? TRIGGERS.filter((t) => t.surface === surface) : TRIGGERS;
}

export function stepsBySurface(surface?: Surface): StepCatalogEntry[] {
  return surface ? STEPS.filter((s) => s.surface === surface) : STEPS;
}

export type { CatalogEntry, StepCatalogEntry, TriggerCatalogEntry, Surface } from "./types";
