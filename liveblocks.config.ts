import type { LiveList, LiveMap, LiveObject } from "@liveblocks/client";
import type { TaskStatus } from "./lib/db/types";

/**
 * Spreadsheet selection coordinate. `colId@rowId` is the LiveMap cell key.
 * Exported from this file (alongside the global augmentation) so consumers
 * can `import type { SheetSelectionRange } from "@/liveblocks.config"`.
 */
export type SheetCellAddress = { columnId: string; rowId: string };
export type SheetSelectionRange = {
  start: SheetCellAddress;
  end: SheetCellAddress;
};

/**
 * Per-cell formatting. All fields are optional — cells without a `format`
 * entry render with the sheet defaults. Stored as a plain JSON object inside
 * the cell `LiveObject`, so format changes diff cheaply and merge with
 * concurrent value edits.
 */
export type CellNumberFormat =
  | "plain"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "datetime";

export type CellAlign = "left" | "center" | "right";

export type CellFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  textColor?: string;
  bgColor?: string;
  align?: CellAlign;
  numberFormat?: CellNumberFormat;
  /** Decimal digits for number/currency/percent formats. */
  decimals?: number;
};

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
      // Spreadsheet room: the anchor cell ID this user has selected, in
      // `colId:rowId` form (see lib/spreadsheet/cell-id.ts). Drives the
      // "Alice is here" cell border + name pill on other collaborators'
      // grids. Null when not in a sheet room.
      selectedCell: string | null;
      // Spreadsheet room: the full rectangle this user has selected. Distinct
      // from selectedCell because Shift+arrow / Shift+click can extend the
      // selection beyond the anchor. Null = no selection or single-cell only.
      selectionRange: SheetSelectionRange | null;
    };
    /**
     * Storage tree. Only sheet rooms populate `spreadsheet`; other rooms
     * leave it absent. The Tiptap doc editor uses Yjs (separate API on the
     * same room) and the tasks/calendar rooms use Comments/presence only.
     */
    Storage: {
      spreadsheet?: LiveObject<{
        cells: LiveMap<
          string,
          LiveObject<{ value: string; format?: CellFormat }>
        >;
        columns: LiveList<LiveObject<{ id: string; width: number }>>;
        rows: LiveList<LiveObject<{ id: string; height: number }>>;
      }>;
    };
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
