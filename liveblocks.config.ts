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
  | "datetime"
  | "custom";

export type CellAlign = "left" | "center" | "right";

export type CellBorderStyle =
  | "thin"
  | "medium"
  | "thick"
  | "dashed"
  | "dotted"
  | "double";
export type CellBorder = { style: CellBorderStyle; color: string };

export type CellWrap = "overflow" | "wrap" | "clip";
export type CellVerticalAlign = "top" | "middle" | "bottom";

/** Chart kinds supported via Recharts. */
export type ChartType =
  | "line"
  | "bar"
  | "column"
  | "area"
  | "pie"
  | "scatter";

/**
 * Conditional formatting rule. Stored in `sheet.conditionalRules` as a
 * `LiveMap<ruleId, ConditionalRule>` so individual rules can be edited
 * without rewriting the whole list (good for collaborative use).
 */
export type ConditionalRuleCondition =
  | {
      kind: "cellIs";
      op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "between";
      value: string;
      value2?: string;
    }
  | { kind: "textContains"; value: string }
  | { kind: "isEmpty" }
  | { kind: "isNotEmpty" }
  | { kind: "isError" }
  | { kind: "formula"; expression: string }
  | { kind: "colorScale"; minColor: string; midColor?: string; maxColor: string };

export type ConditionalRule = {
  id: string;
  range: { startRef: string; endRef: string };
  condition: ConditionalRuleCondition;
  format: Partial<CellFormat>;
};

/**
 * Data-validation rule, attached per-cell. The cell's value is checked when
 * committed; invalid input shows a red border + tooltip but isn't rejected.
 * (Excel/Sheets is the same — validation warns, doesn't reject.)
 */
export type DataValidationRule =
  | { kind: "list"; values: string[] }
  | { kind: "checkbox" }
  | { kind: "numberRange"; min?: number; max?: number }
  | { kind: "dateRange"; min?: string; max?: string }
  | { kind: "textLength"; min?: number; max?: number }
  | { kind: "formula"; expression: string };

export type CellFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  textColor?: string;
  bgColor?: string;
  align?: CellAlign;
  verticalAlign?: CellVerticalAlign;
  numberFormat?: CellNumberFormat;
  /** Decimal digits for number/currency/percent formats. */
  decimals?: number;
  /**
   * Excel-style format string (e.g. `$#,##0.00;[Red]-$#,##0.00`). Only
   * used when `numberFormat === "custom"`.
   */
  customNumberFormat?: string;
  /** Hyperlink to navigate to on cell-text click. */
  link?: string;
  /** CSS font-family stack identifier. See `SHEET_FONTS` in sheet-format-toolbar.tsx. */
  fontFamily?: string;
  /** Font size in px (clamped to 6–96 in the UI). */
  fontSize?: number;
  /** Borders — independent per edge so partial border sets are diffable. */
  borderTop?: CellBorder;
  borderRight?: CellBorder;
  borderBottom?: CellBorder;
  borderLeft?: CellBorder;
  /**
   * Text wrap mode. `overflow` (default) lets long strings extend rightward
   * into empty neighbors; `wrap` wraps within the cell; `clip` truncates.
   */
  wrap?: CellWrap;
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
      // `colId@rowId` form (see lib/spreadsheet/cell-id.ts). Drives the
      // "Alice is here" cell border + name pill on other collaborators'
      // grids. Null when not in a sheet room.
      selectedCell: string | null;
      // Spreadsheet room: the full rectangle this user has selected. Distinct
      // from selectedCell because Shift+arrow / Shift+click can extend the
      // selection beyond the anchor. Null = no selection or single-cell only.
      selectionRange: SheetSelectionRange | null;
      // Spreadsheet workbook: the sheet id this user is currently looking at.
      // Lets other collaborators filter cell-selection chrome to "only the
      // sheet I'm on" and powers the avatar dots on each tab.
      activeSheetId: string | null;
      // Workflow builder: the step id this user currently has open in the
      // inspector. Powers "Alice is on step 3" chips in the collaborator stack.
      // Optional so other rooms' initialPresence needn't set it.
      workflowSelectedStepId?: string | null;
    };
    /**
     * Storage tree.
     *
     * Workbook + multi-sheet shape is `workbook`. The old single-sheet
     * shape lives as `spreadsheet` for read-back compatibility — sheets
     * created before the workbook refactor are auto-promoted to a
     * `workbook` with one sheet on first write (see `usePromoteLegacy` in
     * `lib/spreadsheet/mutations.ts`). New writes always target `workbook`.
     */
    Storage: {
      workbook?: LiveObject<{
        activeSheetId: string;
        sheets: LiveList<
          LiveObject<{
            id: string;
            title: string;
            color?: string;
            cells: LiveMap<
              string,
              LiveObject<{ value: string; format?: CellFormat }>
            >;
            columns: LiveList<
              LiveObject<{ id: string; width: number; hidden?: boolean }>
            >;
            rows: LiveList<
              LiveObject<{ id: string; height: number; hidden?: boolean }>
            >;
            // Merge regions: key = top-left cellId, value = bottom-right cellId.
            merges: LiveMap<string, string>;
            // Number of frozen rows / columns from the top / left. 0 = none.
            frozenRows: number;
            frozenColumns: number;
            // Conditional formatting rules. Optional so workbooks created
            // before Phase 4 still type-check; readers fall back to {}.
            conditionalRules?: LiveMap<string, ConditionalRule>;
            // Per-cell data validation. Optional, same reasoning.
            validations?: LiveMap<string, DataValidationRule>;
            // Sheet is read-only when true (protected). Optional.
            protected?: boolean;
            // Row-/column-group outline levels. Optional.
            groupLevelsRow?: LiveMap<string, number>;
            groupLevelsCol?: LiveMap<string, number>;
            // Collapsed-group state. Optional.
            collapsedRows?: LiveMap<string, true>;
            collapsedCols?: LiveMap<string, true>;
          }>
        >;
        // Workbook-scoped named ranges. Key = name. Range is a sheet-scoped
        // pair of cell IDs.
        namedRanges: LiveMap<
          string,
          { sheetId: string; startRef: string; endRef: string }
        >;
        // Floating charts anchored to a sheet. Position is in CSS pixels
        // relative to the sheet's top-left data cell (excluding the
        // row-header gutter). Move + resize by dragging the chart's chrome.
        charts: LiveList<
          LiveObject<{
            id: string;
            sheetId: string;
            type: ChartType;
            startRef: string;
            endRef: string;
            title: string;
            x: number;
            y: number;
            width: number;
            height: number;
            /** Treat the first row of the source range as labels (x-axis values). */
            firstRowIsHeader?: boolean;
            /** Treat the first column of the source range as labels. */
            firstColumnIsHeader?: boolean;
          }>
        >;
      }>;
      /** Legacy — read-fallback only. Dropped after the migration. */
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
      | { type: "calendar-invalidate" }
      // Workflow builder: a peer changed the spec (JSON-stringified for the
      // wire). Receivers mirror it live for co-editing; only the editing client
      // persists (the rev lets the receiver ignore its own echo).
      | { type: "workflow-spec"; spec: string; rev: number };
    ThreadMetadata: {
      taskId?: string;
      // Spreadsheet cell-anchored threads. Set when a comment is posted on
      // a sheet cell. `sheetId` + `cellId` together pinpoint the cell across
      // the workbook. The presence of `kind: "cell"` lets the documents
      // editor cleanly ignore sheet threads (and vice-versa).
      kind?: "cell";
      sheetId?: string;
      cellId?: string;
    };
  }
}

export {};
