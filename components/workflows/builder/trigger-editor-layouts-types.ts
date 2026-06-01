import type { ReactNode } from "react";

export type TriggerEditorSlots = {
  eventSelect: ReactNode;
  labelFilter: ReactNode | null;
  scheduleConfig: ReactNode | null;
  summary: string;
  dataContext: ReactNode;
  conditions: ReactNode | null;
};
