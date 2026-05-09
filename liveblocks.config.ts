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
    };
    Storage: Record<string, never>;
    RoomEvent:
      | { type: "task-invalidate"; taskId: string }
      | { type: "tasks-invalidate" };
    ThreadMetadata: {
      taskId?: string;
    };
  }
}

export {};
