"use client";

import { createContext, useContext } from "react";

/**
 * What a host drawer hands down to the TaskDetail inside it, so the task's
 * own gr8r `.drawer-h` grows the drawer's expand + close buttons instead of
 * the host stacking a second header above it. Context (not props) because
 * TaskRoom sits between the drawer and TaskDetail.
 */
export type TaskDrawerChrome = {
  /** Close the drawer (Esc does the same). */
  onClose: () => void;
  /** "Full page" — the task's own route. */
  expandHref: string;
  /** gr8r's centred "full" drawer toggle (side panel ⇄ wide modal). */
  full: boolean;
  onToggleFull: () => void;
};

export const TaskDrawerChromeContext = createContext<TaskDrawerChrome | null>(
  null,
);

export function useTaskDrawerChrome(): TaskDrawerChrome | null {
  return useContext(TaskDrawerChromeContext);
}
