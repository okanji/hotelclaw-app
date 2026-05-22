import type { TaskStatus } from "./lib/db/types";

declare global {
  interface Liveblocks {
    UserMeta: {
      id: string;
      info: {
        name: string;
        avatar?: string;
        color?: string;
      };
    };
    Presence: {
      cursor: { x: number; y: number } | null;
      selectedTaskId: string | null;
      // Task currently being dragged by this user on the Kanban board, so
      // other people in the room can see a live "being moved" indicator.
      draggingTaskId: string | null;
      // Calendar room: which event (meeting id, or task scheduled-block id)
      // this user currently has open in the edit dialog. Null when not in
      // the calendar or no dialog open. Drives "Alice is editing" chips on
      // other people's grids.
      editingEventId: string | null;
      // Calendar room: the day the user has focusDate on. Powers the small
      // "Alice • Aug 4" pill in the live-collaborators avatar stack so a
      // teammate can jump to whatever week they're looking at.
      focusedDay: string | null;
    };
    Storage: Record<string, never>;
    RoomEvent:
      | { type: "task-invalidate"; taskId: string }
      | { type: "tasks-invalidate" }
      // Broadcast on every Kanban drag so other clients can move the card
      // optimistically instead of refetching the whole board.
      | {
          type: "task-moved";
          taskId: string;
          status: TaskStatus;
          position: number;
        }
      // Calendar: a peer just mutated a meeting / attendee / scheduled task.
      // Receivers invalidate the calendar query immediately instead of
      // waiting for the Supabase Realtime hop, which can lag a second or
      // two under load. Postgres + Realtime stay authoritative.
      | { type: "calendar-invalidate" };
    ThreadMetadata: {
      taskId?: string;
    };
  }
}

export {};
