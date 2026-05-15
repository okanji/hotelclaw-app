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
        };
    ThreadMetadata: {
      taskId?: string;
    };
  }
}

export {};
