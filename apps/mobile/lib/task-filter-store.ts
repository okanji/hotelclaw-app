import { useCallback, useSyncExternalStore } from "react";
import { EMPTY_TASK_FILTERS, type TaskFilters } from "./task-filters";

export type Scope = "mine" | "open" | "all";

type State = { scope: Scope; filters: TaskFilters };

/**
 * Task list state lives OUTSIDE the screen component.
 *
 * Opening a task pushes onto the root stack, and coming back must land on the
 * same filtered list you left — but screen-local `useState` is lost whenever
 * the tab screen unmounts (tab switches, or the navigator dropping an inactive
 * screen), which silently reset the list to the default scope. A module-level
 * store survives all of that, and `useSyncExternalStore` keeps every subscriber
 * in step.
 *
 * Deliberately NOT persisted to AsyncStorage: filters are a within-session
 * working set, and a filter silently surviving an app restart is its own
 * confusion ("where did my tasks go?").
 */
let state: State = { scope: "mine", filters: EMPTY_TASK_FILTERS };

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): State {
  return state;
}

export function useTaskListState() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setScope = useCallback((scope: Scope) => {
    state = { ...state, scope };
    emit();
  }, []);

  const setFilters = useCallback(
    (next: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => {
      const filters =
        typeof next === "function" ? next(state.filters) : next;
      state = { ...state, filters };
      emit();
    },
    [],
  );

  return { ...snapshot, setScope, setFilters };
}
