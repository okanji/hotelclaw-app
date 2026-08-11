import type { ReactNode } from "react";

export type TriggerEditorSlots = {
  eventSelect: ReactNode;
  labelFilter: ReactNode | null;
  /** `task.field_changed`: which custom field (and landing value) to watch. */
  fieldFilter?: ReactNode | null;
  scheduleConfig: ReactNode | null;
  /** Webhook/form trigger: the inbound URL panel. */
  webhookUrl?: ReactNode | null;
  summary: string;
  dataContext: ReactNode;
  conditions: ReactNode | null;
};
