"use client";

/**
 * Spreadsheet surface — table grid, selection + edition state, keyboard nav,
 * clipboard, formula bar, format toolbar, find/replace, sort, AutoFill, zoom.
 *
 * Selection model:
 *   - `selection.start` is the anchor (first click / arrowed-to cell).
 *   - `selection.end` is the focus (where Shift+click / Shift+arrow extends).
 *   - Single-cell is just `start === end`.
 *   - We mirror `start` to presence (`selectedCell`) and the full range
 *     (`selectionRange`) so other collaborators can see them.
 *
 * The Liveblocks `RoomProvider` is one level up (`<SheetEditor>`); this file
 * lives inside the `ClientSideSuspense` boundary and assumes Storage loaded.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  useCanRedo,
  useCanUndo,
  useHistory,
  useMyPresence,
  useOthers,
  useSelf,
  useStorage,
} from "@liveblocks/react/suspense";
import { usePinch } from "@use-gesture/react";
import {
  BarChart3,
  ChevronDown,
  Database,
  FileDown,
  Lock,
  Plus,
  Printer,
  Redo2,
  Undo2,
  Unlock,
  Upload,
} from "lucide-react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { encodeCellId } from "@/lib/spreadsheet/cell-id";
import {
  COLUMN_DEFAULT_WIDTH,
  COLUMN_HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
} from "@/lib/spreadsheet/constants";
import {
  evaluateCellGraph,
  type ExpressionResult,
  type GridShape,
} from "@/lib/spreadsheet/formula";
import { unwriteRefsToA1 } from "@/lib/spreadsheet/initial";
import { getColumnLabel } from "@/lib/spreadsheet/formula/utils";
import { evaluateConditionalFormats } from "@/lib/spreadsheet/conditional-format";
import type {
  ConditionalRule,
  DataValidationRule,
} from "@/liveblocks.config";
import {
  useAddChart,
  useAddConditionalRule,
  useAddNamedRange,
  useRemoveDuplicates,
  useAddSheet,
  useAutoFill,
  useClearCells,
  useDeleteChart,
  useDeleteColumn,
  useDeleteConditionalRule,
  useDeleteNamedRange,
  useDeleteRow,
  useDeleteSheet,
  useDuplicateSheet,
  useUpdateChart,
  useInsertColumn,
  useInsertRow,
  useMergeCells,
  useMigrateLegacy,
  useMoveColumn,
  useMoveRow,
  usePasteRange,
  useRenameSheet,
  useReorderSheet,
  useResizeColumn,
  useResizeRow,
  useSetActiveSheet,
  useSetCellFormat,
  useSetCellValue,
  useSetFreeze,
  useSetGroupLevel,
  useSetSheetColor,
  useSetValidation,
  useSortColumn,
  useToggleHideColumn,
  useToggleHideRow,
  useToggleProtectSheet,
  useUnmergeCells,
} from "@/lib/spreadsheet/mutations";
import {
  SheetNamedRangesPanel,
  type NamedRangeRow,
} from "./sheet-named-ranges-dialog";
import {
  CommentsSidebarButton,
  NewCellCommentButton,
  useActiveSheetCommentCellIds,
} from "./sheet-cell-comments";
import { SheetChartsLayer, type ChartSpec } from "./sheet-charts";
import { SheetContextMenu, type ContextMenuSection } from "./sheet-context-menu";
import { SheetShortcutsModal } from "./sheet-shortcuts";
import type { ChartType } from "@/liveblocks.config";
import {
  exportCsv,
  exportTsv,
  exportXlsx,
  importSpreadsheetFile,
  sheetToMatrix,
} from "@/lib/spreadsheet/io";
import type {
  CellFormat,
  SheetCellAddress,
} from "@/liveblocks.config";
import { SheetCell, type CellOther } from "./sheet-cell";
import { SheetFindReplace, type FindMatch } from "./sheet-find-replace";
import {
  SheetFormatToolbar,
  type BorderPreset,
  type FormatPatch,
} from "./sheet-format-toolbar";
import type { CellBorder } from "@/liveblocks.config";
import { SheetFormulaBar, cellLabelFor } from "./sheet-formula-bar";
import { ColumnHandle, HeadersDnd, RowHandle } from "./sheet-headers";
import { SheetTabBar } from "./sheet-tab-bar";
import "./spreadsheet.css";

/** Liveblocks LiveMap renders to a plain readonly record under `useStorage`. */
type CellEntry = { readonly value: string; readonly format?: CellFormat };
type CellMatrix = Readonly<Record<string, CellEntry | undefined>>;

type SelectionState = {
  start: SheetCellAddress;
  end: SheetCellAddress;
};

type EditionState =
  | { columnId: string; rowId: string; seed: string | null }
  | null;

type AutoFillState = {
  seed: { start: SheetCellAddress; end: SheetCellAddress };
  target: SheetCellAddress;
} | null;

/** Top-level for one room's grid. */
export function SheetSurface({ documentId }: { documentId?: string } = {}) {
  // ── Storage selectors ────────────────────────────────────────────────────
  // The workbook lives at `root.workbook`. Pre-workbook rooms still carry the
  // legacy `root.spreadsheet` shape; we detect that, auto-promote via
  // `useMigrateLegacy`, and render a brief skeleton while the migration
  // commits. After the migration both shapes coexist for one render then
  // settle on `workbook`.
  const hasWorkbook = useStorage((root) => root.workbook != null);
  const hasLegacy = useStorage(
    (root) => root.workbook == null && root.spreadsheet != null,
  );
  const sheetsList = useStorage((root) =>
    root.workbook?.sheets ?? [],
  ) as ReadonlyArray<{
    id: string;
    title: string;
    color?: string;
    cells: CellMatrix;
    columns: ReadonlyArray<{ id: string; width: number; hidden?: boolean }>;
    rows: ReadonlyArray<{ id: string; height: number; hidden?: boolean }>;
    merges: Readonly<Record<string, string>>;
    frozenRows: number;
    frozenColumns: number;
    conditionalRules?: Readonly<Record<string, ConditionalRule>>;
    validations?: Readonly<Record<string, DataValidationRule>>;
    protected?: boolean;
    groupLevelsRow?: Readonly<Record<string, number>>;
    groupLevelsCol?: Readonly<Record<string, number>>;
    collapsedRows?: Readonly<Record<string, true>>;
    collapsedCols?: Readonly<Record<string, true>>;
  }>;
  const remoteActiveSheetId = useStorage(
    (root) => root.workbook?.activeSheetId ?? null,
  );
  const namedRanges = useStorage(
    (root) => root.workbook?.namedRanges ?? {},
  ) as Readonly<
    Record<string, { sheetId: string; startRef: string; endRef: string }>
  >;

  // Each user picks their own active sheet locally. The workbook's
  // `activeSheetId` is just the "last viewer" so a new joiner lands on
  // something sensible — switching sheets doesn't yank other users.
  const [localActiveSheetId, setLocalActiveSheetId] = useState<string | null>(
    null,
  );
  const activeSheetId =
    localActiveSheetId ?? remoteActiveSheetId ?? sheetsList[0]?.id ?? "";
  const activeSheet =
    sheetsList.find((s) => s.id === activeSheetId) ?? sheetsList[0];

  // Surface the active sheet's slices to the rest of the component.
  const columns = activeSheet?.columns ?? [];
  const rows = activeSheet?.rows ?? [];
  const cells = activeSheet?.cells as CellMatrix | undefined;

  const history = useHistory();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const migrateLegacy = useMigrateLegacy();
  // Fire-once migration when we detect legacy storage. Liveblocks's
  // mutation hook returns a stable function so this effect only fires when
  // `hasLegacy` flips from false → true (i.e. on first connect against a
  // pre-workbook room).
  useEffect(() => {
    if (hasLegacy) migrateLegacy();
  }, [hasLegacy, migrateLegacy]);

  // Bound mutations: thread `activeSheetId` so the surface doesn't have to
  // pass it at every call site. `useMutation` returns a stable identity per
  // render with the same closure deps, so wrapping with useCallback keeps
  // the API ergonomic without sacrificing re-render efficiency.
  const insertColumnRaw = useInsertColumn();
  const insertRowRaw = useInsertRow();
  const deleteColumnRaw = useDeleteColumn();
  const deleteRowRaw = useDeleteRow();
  const moveColumnRaw = useMoveColumn();
  const moveRowRaw = useMoveRow();
  const resizeColumnRaw = useResizeColumn();
  const resizeRowRaw = useResizeRow();
  const setCellValueRaw = useSetCellValue();
  const setCellFormatRaw = useSetCellFormat();
  const sortColumnRaw = useSortColumn();
  const autoFillRaw = useAutoFill();
  const clearCellsRaw = useClearCells();
  const pasteRangeRaw = usePasteRange();

  const insertColumn = useCallback(
    (idx: number, w?: number) => insertColumnRaw(activeSheetId, idx, w),
    [insertColumnRaw, activeSheetId],
  );
  const insertRow = useCallback(
    (idx: number, h?: number) => insertRowRaw(activeSheetId, idx, h),
    [insertRowRaw, activeSheetId],
  );
  const deleteColumn = useCallback(
    (idx: number) => deleteColumnRaw(activeSheetId, idx),
    [deleteColumnRaw, activeSheetId],
  );
  const deleteRow = useCallback(
    (idx: number) => deleteRowRaw(activeSheetId, idx),
    [deleteRowRaw, activeSheetId],
  );
  const moveColumn = useCallback(
    (from: number, to: number) => moveColumnRaw(activeSheetId, from, to),
    [moveColumnRaw, activeSheetId],
  );
  const moveRow = useCallback(
    (from: number, to: number) => moveRowRaw(activeSheetId, from, to),
    [moveRowRaw, activeSheetId],
  );
  const resizeColumn = useCallback(
    (idx: number, w: number) => resizeColumnRaw(activeSheetId, idx, w),
    [resizeColumnRaw, activeSheetId],
  );
  const resizeRow = useCallback(
    (idx: number, h: number) => resizeRowRaw(activeSheetId, idx, h),
    [resizeRowRaw, activeSheetId],
  );
  const setCellValue = useCallback(
    (col: string, row: string, value: string) =>
      setCellValueRaw(activeSheetId, col, row, value),
    [setCellValueRaw, activeSheetId],
  );
  const setCellFormat = useCallback(
    (
      addresses: ReadonlyArray<{ columnId: string; rowId: string }>,
      patch: Partial<CellFormat>,
    ) => setCellFormatRaw(activeSheetId, addresses, patch),
    [setCellFormatRaw, activeSheetId],
  );
  const sortColumn = useCallback(
    (idx: number, dir: "asc" | "desc") =>
      sortColumnRaw(activeSheetId, idx, dir),
    [sortColumnRaw, activeSheetId],
  );
  const autoFill = useCallback(
    (
      stl: { columnId: string; rowId: string },
      sbr: { columnId: string; rowId: string },
      ttl: { columnId: string; rowId: string },
      tbr: { columnId: string; rowId: string },
    ) => autoFillRaw(activeSheetId, stl, sbr, ttl, tbr),
    [autoFillRaw, activeSheetId],
  );
  const clearCells = useCallback(
    (addresses: ReadonlyArray<{ columnId: string; rowId: string }>) =>
      clearCellsRaw(activeSheetId, addresses),
    [clearCellsRaw, activeSheetId],
  );
  const pasteRange = useCallback(
    (
      topLeft: { columnId: string; rowId: string },
      matrix: ReadonlyArray<ReadonlyArray<string>>,
    ) => pasteRangeRaw(activeSheetId, topLeft, matrix),
    [pasteRangeRaw, activeSheetId],
  );

  // Workbook-level mutations (no sheetId on most).
  const addSheet = useAddSheet();
  const deleteSheet = useDeleteSheet();
  const renameSheet = useRenameSheet();
  const duplicateSheet = useDuplicateSheet();
  const reorderSheet = useReorderSheet();
  const setActiveSheet = useSetActiveSheet();
  const setSheetColor = useSetSheetColor();
  const toggleHideColumnRaw = useToggleHideColumn();
  const toggleHideRowRaw = useToggleHideRow();
  const setFreezeRaw = useSetFreeze();
  const hideColumn = useCallback(
    (idx: number) => toggleHideColumnRaw(activeSheetId, idx, true),
    [toggleHideColumnRaw, activeSheetId],
  );
  const hideRow = useCallback(
    (idx: number) => toggleHideRowRaw(activeSheetId, idx, true),
    [toggleHideRowRaw, activeSheetId],
  );
  const showAllColumns = useCallback(() => {
    columns.forEach((c, i) => {
      if (c.hidden) toggleHideColumnRaw(activeSheetId, i, false);
    });
  }, [columns, toggleHideColumnRaw, activeSheetId]);
  const showAllRows = useCallback(() => {
    rows.forEach((r, i) => {
      if (r.hidden) toggleHideRowRaw(activeSheetId, i, false);
    });
  }, [rows, toggleHideRowRaw, activeSheetId]);
  const freezeColumns = useCallback(
    (count: number) =>
      setFreezeRaw(activeSheetId, activeSheet?.frozenRows ?? 0, count),
    [setFreezeRaw, activeSheetId, activeSheet?.frozenRows],
  );
  const freezeRows = useCallback(
    (count: number) =>
      setFreezeRaw(activeSheetId, count, activeSheet?.frozenColumns ?? 0),
    [setFreezeRaw, activeSheetId, activeSheet?.frozenColumns],
  );

  const addNamedRange = useAddNamedRange();
  const deleteNamedRange = useDeleteNamedRange();
  const mergeCellsRaw = useMergeCells();
  const unmergeCellsRaw = useUnmergeCells();

  // Data tools — conditional formatting, validation, sheet protection
  const addConditionalRuleRaw = useAddConditionalRule();
  const deleteConditionalRuleRaw = useDeleteConditionalRule();
  const setValidationRaw = useSetValidation();
  const toggleProtectRaw = useToggleProtectSheet();
  const setGroupLevelRaw = useSetGroupLevel();
  const removeDuplicatesRaw = useRemoveDuplicates();
  void setGroupLevelRaw;
  /** Delete a conditional-format rule by id (used by the rules manager). */
  const deleteConditionalRule = useCallback(
    (ruleId: string) => {
      if (!activeSheetId) return;
      deleteConditionalRuleRaw(activeSheetId, ruleId);
    },
    [deleteConditionalRuleRaw, activeSheetId],
  );

  // Charts — `insertChart` lives further down (depends on colIds/rowIds and
  // a ref into `selectionBounds`).
  const addChartRaw = useAddChart();
  const updateChartRaw = useUpdateChart();
  const deleteChartRaw = useDeleteChart();
  const chartsList = useStorage(
    (root) => root.workbook?.charts ?? [],
  ) as ReadonlyArray<ChartSpec>;
  const selectionBoundsRef = useRef<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  // `mergeSelection` is declared below — depends on `selectionBounds`.
  // Named-range memos are computed below `selection`/`colIndex`/`rowIndex`
  // (search "namedRangeRows" later in this file).

  // Conditional-format + validation memos are computed below `cellGraph` —
  // search "conditionalOverrides" further down in this file.

  /** Cell ids on the active sheet that carry an unresolved comment thread. */
  const cellsWithComments = useActiveSheetCommentCellIds(activeSheetId || "");
  /** sheetId → title (for the comments sidebar grouping label). */
  const sheetTitlesMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sheetsList) m.set(s.id, s.title);
    return m;
  }, [sheetsList]);
  // `switchToCellAcrossSheets` is defined after `switchSheet` below — search
  // for it.

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [edition, setEdition] = useState<EditionState>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    columnId: string;
    rowId: string;
  } | null>(null);
  const draggingRef = useRef<"select" | null>(null);
  const [autoFillState, setAutoFillState] = useState<AutoFillState>(null);
  const fillingRef = useRef(false);

  const switchSheet = useCallback(
    (sheetId: string) => {
      setLocalActiveSheetId(sheetId);
      setActiveSheet(sheetId);
      // Selection/edition are per-sheet — clear them on switch so we don't
      // restore stale coordinates from a different sheet's cell ids.
      setSelection(null);
      setEdition(null);
    },
    [setActiveSheet],
  );

  /** Switch to a sheet + select the targeted cell. Used by the comments sidebar. */
  const switchToCellAcrossSheets = useCallback(
    (sheetId: string, cellId: string) => {
      const at = cellId.indexOf("@");
      if (at <= 0) return;
      switchSheet(sheetId);
      setSelection({
        start: { columnId: cellId.slice(0, at), rowId: cellId.slice(at + 1) },
        end: { columnId: cellId.slice(0, at), rowId: cellId.slice(at + 1) },
      });
    },
    [switchSheet],
  );

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const zoomStorageKey = documentId
    ? `hotelclaw:sheet-zoom:${documentId}`
    : null;
  const [zoom, setZoomState] = useState<number>(() => {
    if (typeof window === "undefined" || !zoomStorageKey) return ZOOM_DEFAULT;
    const raw = window.localStorage.getItem(zoomStorageKey);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX
      ? n
      : ZOOM_DEFAULT;
  });
  const setZoom = useCallback(
    (next: number) => {
      const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      setZoomState(clamped);
      if (typeof window !== "undefined" && zoomStorageKey) {
        window.localStorage.setItem(zoomStorageKey, String(clamped));
      }
    },
    [zoomStorageKey],
  );
  const zoomIn = useCallback(() => {
    const next = ZOOM_STEPS.find((s) => s > zoom + 0.001) ?? ZOOM_MAX;
    setZoom(next);
  }, [zoom, setZoom]);
  const zoomOut = useCallback(() => {
    const reversed = [...ZOOM_STEPS].reverse();
    const next = reversed.find((s) => s < zoom - 0.001) ?? ZOOM_MIN;
    setZoom(next);
  }, [zoom, setZoom]);
  const zoomReset = useCallback(() => setZoom(ZOOM_DEFAULT), [setZoom]);

  // ── Trackpad pinch + touchscreen pinch ────────────────────────────────────
  // Refs let the listeners read the latest zoom without re-binding every
  // render — we only want one wheel listener registered for the lifetime of
  // the scroll container.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);


  // Ctrl/meta + wheel = "pinch" on every modern trackpad + Ctrl+wheel on a
  // mouse. The browser's default is to zoom the whole page — we preventDefault
  // and apply our own grid zoom. React's onWheel is passive in React 19, so
  // attach a real DOM listener with { passive: false } to call preventDefault.
  //
  // Plain wheel events (no ctrl) intentionally fall through so a two-finger
  // trackpad scroll just scrolls the grid natively — no code needed for that
  // case, the scroll container has overflow:auto.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Exponential factor keeps zoom consistent across input devices:
      // a hard scroll (large |deltaY|) yields a proportionally larger zoom
      // step than many tiny pinch events.
      const factor = Math.exp(-e.deltaY * 0.01);
      setZoom(zoomRef.current * factor);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  // Touchscreen pinch (and Safari's gesture events). @use-gesture's `usePinch`
  // abstracts both. `from: () => [current]` lets the hook start each gesture
  // from the current zoom rather than 1; `scaleBounds` clamps in-flight so
  // rubberband (if enabled) stays in range.
  const bindPinch = usePinch(
    ({ offset: [scale] }) => {
      setZoom(scale);
    },
    {
      scaleBounds: { min: ZOOM_MIN, max: ZOOM_MAX },
      from: () => [zoomRef.current, 0],
      // Touch-only — desktop trackpad pinches are handled by the wheel
      // listener above. Without this guard, usePinch on macOS competes with
      // our wheel handler and the two double-up.
      eventOptions: { passive: false },
    },
  );

  // Mirror selection + active sheet into presence so collaborators see our
  // cursor AND know which sheet to render it on.
  const [, updatePresence] = useMyPresence();
  useEffect(() => {
    updatePresence({
      selectedCell: selection
        ? encodeCellId(selection.start.columnId, selection.start.rowId)
        : null,
      selectionRange: selection,
      activeSheetId: activeSheetId || null,
    });
  }, [selection, activeSheetId, updatePresence]);

  // ── Visible columns/rows + freeze offsets ────────────────────────────────
  // Hidden columns/rows aren't rendered but their cell ids remain valid for
  // formula references. The grid loop iterates `visibleColumns` /
  // `visibleRows`; the `index` on each entry is the STORAGE index (what
  // mutations expect), distinct from the visible position.
  const visibleColumns = useMemo(
    () =>
      columns
        .map((c, i) => ({ ...c, index: i }))
        .filter((c) => !c.hidden),
    [columns],
  );
  const visibleRows = useMemo(
    () => rows.map((r, i) => ({ ...r, index: i })).filter((r) => !r.hidden),
    [rows],
  );

  const frozenColumnsCount = activeSheet?.frozenColumns ?? 0;
  const frozenRowsCount = activeSheet?.frozenRows ?? 0;

  /** Cumulative left offset (data-cell coords) for each visible column. */
  const columnLeftOffsets = useMemo(() => {
    const out: number[] = [];
    let left = 0;
    for (const c of visibleColumns) {
      out.push(left);
      left += c.width;
    }
    return out;
  }, [visibleColumns]);
  /** Cumulative top offset (data-cell coords) for each visible row. */
  const rowTopOffsets = useMemo(() => {
    const out: number[] = [];
    let top = 0;
    for (const r of visibleRows) {
      out.push(top);
      top += r.height;
    }
    return out;
  }, [visibleRows]);

  // ── Cell graph evaluation ─────────────────────────────────────────────────
  const colIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const shape: GridShape = useMemo(
    () => ({ columnIds: colIds, rowIds, namedRanges }),
    [colIds, rowIds, namedRanges],
  );

  const rawCellsByKey = useMemo(() => {
    const map = new Map<string, string>();
    if (!cells) return map;
    for (const [key, cell] of Object.entries(cells)) {
      if (cell?.value) map.set(key, cell.value);
    }
    return map;
  }, [cells]);
  const cellGraph = useMemo(
    () => evaluateCellGraph(rawCellsByKey, shape),
    [rawCellsByKey, shape],
  );

  /**
   * Conditional-format overrides per cell. Computed AFTER `cellGraph` so
   * formula rules can read evaluated values. Each entry is merged onto the
   * cell's stored `format` before rendering.
   */
  const conditionalOverrides = useMemo(() => {
    if (!activeSheet) return new Map<string, Partial<CellFormat>>();
    const rules = activeSheet.conditionalRules
      ? Object.values(activeSheet.conditionalRules)
      : [];
    if (rules.length === 0) return new Map<string, Partial<CellFormat>>();
    return evaluateConditionalFormats(
      rules as ConditionalRule[],
      shape,
      rawCellsByKey,
      cellGraph,
    );
  }, [activeSheet, shape, rawCellsByKey, cellGraph]);

  /** Validation rules for the active sheet, keyed by cellId. */
  const validations = useMemo(() => {
    const map = new Map<string, DataValidationRule>();
    if (!activeSheet?.validations) return map;
    for (const [k, v] of Object.entries(activeSheet.validations)) {
      map.set(k, v as DataValidationRule);
    }
    return map;
  }, [activeSheet]);

  // ── Other users' selections ───────────────────────────────────────────────
  const self = useSelf();
  const others = useOthers();
  const othersByCell = useMemo(() => {
    const map = new Map<string, CellOther>();
    for (const other of others) {
      if (!other.presence?.selectedCell) continue;
      // Only show another user's selection on the sheet I'm currently
      // viewing. Workbook presence carries `activeSheetId`; if it's missing
      // (very old clients) we fall back to "show always", matching the
      // single-sheet era behavior.
      const remoteSheet = other.presence.activeSheetId;
      if (remoteSheet != null && activeSheetId && remoteSheet !== activeSheetId) {
        continue;
      }
      const color = colorFor(other.connectionId);
      map.set(other.presence.selectedCell, {
        color,
        name: other.info?.name ?? "Anonymous",
      });
    }
    return map;
  }, [others, activeSheetId]);

  /** Avatar dots on each sheet tab — who is currently viewing it. */
  const viewersBySheet = useMemo(() => {
    const map = new Map<string, Array<{ name: string; color: string }>>();
    for (const other of others) {
      const sheetId = other.presence?.activeSheetId;
      if (!sheetId) continue;
      const entry = map.get(sheetId) ?? [];
      entry.push({
        name: other.info?.name ?? "Anonymous",
        color: colorFor(other.connectionId),
      });
      map.set(sheetId, entry);
    }
    return map;
  }, [others]);
  const myColor = self ? colorFor(self.connectionId) : "var(--series-1)";

  // ── Index lookups ─────────────────────────────────────────────────────────
  const colIndex = useCallback((id: string) => colIds.indexOf(id), [colIds]);
  const rowIndex = useCallback((id: string) => rowIds.indexOf(id), [rowIds]);

  const selectionBounds = useMemo(() => {
    if (!selection) return null;
    const sx = colIndex(selection.start.columnId);
    const ex = colIndex(selection.end.columnId);
    const sy = rowIndex(selection.start.rowId);
    const ey = rowIndex(selection.end.rowId);
    if (sx < 0 || ex < 0 || sy < 0 || ey < 0) return null;
    return {
      minX: Math.min(sx, ex),
      maxX: Math.max(sx, ex),
      minY: Math.min(sy, ey),
      maxY: Math.max(sy, ey),
    };
  }, [selection, colIndex, rowIndex]);

  // Keep a ref synced to `selectionBounds` so the `insertChart` callback
  // (which is captured before selectionBounds is computed) reads the latest.
  useEffect(() => {
    selectionBoundsRef.current = selectionBounds;
  }, [selectionBounds]);

  const setSingle = useCallback((columnId: string, rowId: string) => {
    setSelection({
      start: { columnId, rowId },
      end: { columnId, rowId },
    });
  }, []);

  /**
   * Merge maps. `merges` keys are top-left cellIds, values are bottom-right.
   * Computed once per render after `colIds`/`rowIds` are known:
   *   - `mergeSpans`: top-left cellId → {colSpan, rowSpan} for table render
   *   - `mergeHidden`: Set of cellIds that should NOT render at all
   */
  const { mergeSpans, mergeHidden } = useMemo(() => {
    const spans = new Map<string, { colSpan: number; rowSpan: number }>();
    const hidden = new Set<string>();
    if (!activeSheet) return { mergeSpans: spans, mergeHidden: hidden };
    for (const [tl, br] of Object.entries(activeSheet.merges)) {
      const tlAt = tl.indexOf("@");
      const brAt = br.indexOf("@");
      if (tlAt <= 0 || brAt <= 0) continue;
      const tlCol = tl.slice(0, tlAt);
      const tlRow = tl.slice(tlAt + 1);
      const brCol = br.slice(0, brAt);
      const brRow = br.slice(brAt + 1);
      const x1 = colIds.indexOf(tlCol);
      const x2 = colIds.indexOf(brCol);
      const y1 = rowIds.indexOf(tlRow);
      const y2 = rowIds.indexOf(brRow);
      if (x1 < 0 || x2 < 0 || y1 < 0 || y2 < 0) continue;
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      spans.set(tl, { colSpan: maxX - minX + 1, rowSpan: maxY - minY + 1 });
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (x === minX && y === minY) continue;
          const c = colIds[x];
          const r = rowIds[y];
          if (c && r) hidden.add(encodeCellId(c, r));
        }
      }
    }
    return { mergeSpans: spans, mergeHidden: hidden };
  }, [activeSheet, colIds, rowIds]);

  // ── Merge bound helpers (need `selectionBounds` + `colIds`/`rowIds`) ─────
  const mergeSelection = useCallback(() => {
    if (!selectionBounds || !activeSheetId) return;
    const tlCol = colIds[selectionBounds.minX];
    const tlRow = rowIds[selectionBounds.minY];
    const brCol = colIds[selectionBounds.maxX];
    const brRow = rowIds[selectionBounds.maxY];
    if (!tlCol || !tlRow || !brCol || !brRow) return;
    if (tlCol === brCol && tlRow === brRow) return;
    mergeCellsRaw(
      activeSheetId,
      { columnId: tlCol, rowId: tlRow },
      { columnId: brCol, rowId: brRow },
    );
  }, [mergeCellsRaw, activeSheetId, colIds, rowIds, selectionBounds]);
  const unmergeSelection = useCallback(() => {
    if (!selectionBounds || !activeSheetId) return;
    const tlCol = colIds[selectionBounds.minX];
    const tlRow = rowIds[selectionBounds.minY];
    if (!tlCol || !tlRow) return;
    unmergeCellsRaw(activeSheetId, encodeCellId(tlCol, tlRow));
  }, [unmergeCellsRaw, activeSheetId, colIds, rowIds, selectionBounds]);

  /** Quick conditional format: "highlight if > 0" / colorScale on selection. */
  const addQuickConditionalRule = useCallback(
    (
      preset:
        | "highlightGT0"
        | "highlightLT0"
        | "colorScaleRedGreen"
        | "highlightNonEmpty",
    ) => {
      if (!selectionBoundsRef.current || !activeSheetId) return;
      const b = selectionBoundsRef.current;
      const tl = colIds[b.minX];
      const tr = rowIds[b.minY];
      const br = colIds[b.maxX];
      const brr = rowIds[b.maxY];
      if (!tl || !tr || !br || !brr) return;
      const range = {
        startRef: encodeCellId(tl, tr),
        endRef: encodeCellId(br, brr),
      };
      const id = nanoid(8);
      const rule: ConditionalRule = (() => {
        switch (preset) {
          case "highlightGT0":
            return {
              id,
              range,
              condition: { kind: "cellIs", op: "gt", value: "0" },
              format: { bgColor: "#dcfce7" },
            };
          case "highlightLT0":
            return {
              id,
              range,
              condition: { kind: "cellIs", op: "lt", value: "0" },
              format: { bgColor: "#fee2e2" },
            };
          case "colorScaleRedGreen":
            return {
              id,
              range,
              condition: {
                kind: "colorScale",
                minColor: "#fee2e2",
                midColor: "#fef3c7",
                maxColor: "#dcfce7",
              },
              format: {},
            };
          case "highlightNonEmpty":
            return {
              id,
              range,
              condition: { kind: "isNotEmpty" },
              format: { bgColor: "#dbeafe" },
            };
        }
      })();
      addConditionalRuleRaw(activeSheetId, rule);
    },
    [addConditionalRuleRaw, activeSheetId, colIds, rowIds],
  );

  /** Remove duplicate rows from the selected range. */
  const removeDuplicatesInSelection = useCallback(() => {
    const b = selectionBoundsRef.current;
    if (!b || !activeSheetId) return;
    removeDuplicatesRaw(activeSheetId, b);
  }, [removeDuplicatesRaw, activeSheetId]);

  /** Apply a data-validation rule to the current selection. */
  const applyValidation = useCallback(
    (rule: DataValidationRule | null) => {
      if (!selectionBoundsRef.current || !activeSheetId) return;
      const b = selectionBoundsRef.current;
      const ids: string[] = [];
      for (let y = b.minY; y <= b.maxY; y++) {
        for (let x = b.minX; x <= b.maxX; x++) {
          const c = colIds[x];
          const r = rowIds[y];
          if (c && r) ids.push(encodeCellId(c, r));
        }
      }
      if (ids.length === 0) return;
      setValidationRaw(activeSheetId, ids, rule);
    },
    [setValidationRaw, activeSheetId, colIds, rowIds],
  );

  /**
   * Export the active sheet (CSV / TSV) or the whole workbook (XLSX).
   * Reads the latest workbook from `sheetsList` so it picks up un-saved
   * mutations the snapshot pipeline hasn't flushed yet.
   */
  const exportActiveSheetCsv = useCallback(() => {
    if (!activeSheet) return;
    const matrix = sheetToMatrix(
      activeSheet.columns.map((c) => c.id),
      activeSheet.rows.map((r) => r.id),
      rawCellsByKey,
    );
    exportCsv(
      matrix,
      `${activeSheet.title || "sheet"}.csv`.replace(/\s+/g, "-"),
    );
  }, [activeSheet, rawCellsByKey]);

  const exportActiveSheetTsv = useCallback(() => {
    if (!activeSheet) return;
    const matrix = sheetToMatrix(
      activeSheet.columns.map((c) => c.id),
      activeSheet.rows.map((r) => r.id),
      rawCellsByKey,
    );
    exportTsv(
      matrix,
      `${activeSheet.title || "sheet"}.tsv`.replace(/\s+/g, "-"),
    );
  }, [activeSheet, rawCellsByKey]);

  const exportWorkbookXlsx = useCallback(() => {
    // We need each sheet's own raw values map — build per-sheet.
    const sheets = sheetsList.map((s) => {
      const map = new Map<string, string>();
      for (const [k, c] of Object.entries(s.cells)) {
        if (c?.value) map.set(k, c.value);
      }
      return {
        title: s.title,
        matrix: sheetToMatrix(
          s.columns.map((c) => c.id),
          s.rows.map((r) => r.id),
          map,
        ),
      };
    });
    exportXlsx({ filename: "workbook.xlsx", sheets });
  }, [sheetsList]);

  /** Import handler — file chosen via a hidden <input>. Pastes into the active sheet. */
  const importFile = useCallback(
    async (file: File) => {
      if (!activeSheet || !activeSheetId) return;
      try {
        const imported = await importSpreadsheetFile(file);
        // Strategy: for each imported sheet, add a new sheet to the workbook
        // and paste its data. For a single-sheet import we just paste into
        // the active sheet from A1.
        if (imported.length === 1) {
          const m = imported[0]!;
          const topLeft = {
            columnId: activeSheet.columns[0]?.id ?? "",
            rowId: activeSheet.rows[0]?.id ?? "",
          };
          if (topLeft.columnId && topLeft.rowId) {
            pasteRangeRaw(activeSheetId, topLeft, m.matrix);
          }
        } else {
          // Multi-sheet: add a sheet per imported tab, paste into each.
          // We resolve sheet ids by reading back the addSheet target name
          // — but we don't have a return from useMutation. Simpler: paste
          // them all into the active sheet, sequentially. (Users can split
          // later.)
          // For v1, just paste the first into active.
          const m = imported[0]!;
          const topLeft = {
            columnId: activeSheet.columns[0]?.id ?? "",
            rowId: activeSheet.rows[0]?.id ?? "",
          };
          if (topLeft.columnId && topLeft.rowId) {
            pasteRangeRaw(activeSheetId, topLeft, m.matrix);
          }
        }
      } catch (e) {
        // Surface to the user — `alert` is enough for v1.
        // eslint-disable-next-line no-alert
        alert(`Import failed: ${(e as Error).message}`);
      }
    },
    [activeSheet, activeSheetId, pasteRangeRaw],
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const triggerImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /** Insert a `=SPARKLINE(range, type)` formula next to the current selection. */
  const insertSparkline = useCallback(
    (kind: "line" | "column" | "bar" | "winloss") => {
      const b = selectionBoundsRef.current;
      if (!b || !activeSheetId) return;
      const startCol = colIds[b.minX];
      const startRow = rowIds[b.minY];
      const endCol = colIds[b.maxX];
      const endRow = rowIds[b.maxY];
      if (!startCol || !startRow || !endCol || !endRow) return;
      const rangeText = `${getColumnLabel(b.minX)}${b.minY + 1}:${getColumnLabel(b.maxX)}${b.maxY + 1}`;
      // Target: the cell immediately right of the selection's top row.
      const targetX = b.maxX + 1;
      const targetCol = colIds[targetX] ?? colIds[b.minX]!;
      const targetRow = rowIds[b.minY]!;
      setCellValueRaw(
        activeSheetId,
        targetCol,
        targetRow,
        `=SPARKLINE(${rangeText}, "${kind}")`,
      );
    },
    [setCellValueRaw, activeSheetId, colIds, rowIds],
  );

  /** Insert a new chart from the current selection. */
  const insertChart = useCallback(
    (type: ChartType) => {
      const b = selectionBoundsRef.current;
      if (!b || !activeSheetId) return;
      const startCol = colIds[b.minX];
      const startRow = rowIds[b.minY];
      const endCol = colIds[b.maxX];
      const endRow = rowIds[b.maxY];
      if (!startCol || !startRow || !endCol || !endRow) return;
      const sourceWidth = (b.maxX - b.minX + 1) * 120;
      addChartRaw(
        activeSheetId,
        type,
        encodeCellId(startCol, startRow),
        encodeCellId(endCol, endRow),
        {
          x: b.minX * 120 + sourceWidth + 20,
          y: b.minY * 32,
          width: 420,
          height: 280,
        },
      );
    },
    [addChartRaw, activeSheetId, colIds, rowIds],
  );

  // Merge bound helpers — defined further below, after `colIds`/`rowIds`.

  // ── Named-range rows (UI-side derivation) ────────────────────────────────
  const namedRangeRows: NamedRangeRow[] = useMemo(() => {
    const out: NamedRangeRow[] = [];
    for (const [name, def] of Object.entries(namedRanges)) {
      const sheet = sheetsList.find((s) => s.id === def.sheetId);
      const colIdsForSheet = sheet?.columns.map((c) => c.id) ?? [];
      const rowIdsForSheet = sheet?.rows.map((r) => r.id) ?? [];
      const start = unwriteRefsToA1(
        `=${def.startRef}`,
        colIdsForSheet,
        rowIdsForSheet,
      ).slice(1);
      const end = unwriteRefsToA1(
        `=${def.endRef}`,
        colIdsForSheet,
        rowIdsForSheet,
      ).slice(1);
      const sheetName = sheet?.title ?? "?";
      out.push({
        name,
        sheetId: def.sheetId,
        startRef: def.startRef,
        endRef: def.endRef,
        display: `${sheetName}!${start === end ? start : `${start}:${end}`}`,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [namedRanges, sheetsList]);

  const namedRangeSelectionDisplay = useMemo(() => {
    if (!selection || !activeSheetId) return "";
    const start = `${getColumnLabel(colIndex(selection.start.columnId))}${rowIndex(selection.start.rowId) + 1}`;
    const end = `${getColumnLabel(colIndex(selection.end.columnId))}${rowIndex(selection.end.rowId) + 1}`;
    return `${activeSheet?.title ?? "Sheet"}!${start === end ? start : `${start}:${end}`}`;
  }, [
    selection,
    activeSheetId,
    activeSheet?.title,
    colIndex,
    rowIndex,
  ]);

  // ── Formula bar data ──────────────────────────────────────────────────────
  const activeCellLabel = useMemo(() => {
    if (!selection) return "";
    const x = colIndex(selection.start.columnId);
    const y = rowIndex(selection.start.rowId);
    return cellLabelFor(x, y);
  }, [selection, colIndex, rowIndex]);
  const activeRawDisplay = useMemo(() => {
    if (!selection) return "";
    const id = encodeCellId(selection.start.columnId, selection.start.rowId);
    const raw = rawCellsByKey.get(id) ?? "";
    return raw.startsWith("=") ? unwriteRefsToA1(raw, colIds, rowIds) : raw;
  }, [selection, rawCellsByKey, colIds, rowIds]);

  function formulaBarCommit(value: string) {
    if (!selection) return;
    setCellValue(selection.start.columnId, selection.start.rowId, value);
  }

  // ── Active cell's format (for the toolbar toggle state) ───────────────────
  const activeFormat = useMemo<CellFormat | null>(() => {
    if (!selection) return null;
    const id = encodeCellId(selection.start.columnId, selection.start.rowId);
    const entry = cells?.[id];
    return entry?.format ?? null;
  }, [selection, cells]);

  function formatPatch(patch: FormatPatch) {
    if (!selectionBounds) return;
    const addresses = enumerateRange(selectionBounds, colIds, rowIds);
    if (addresses.length === 0) return;
    setCellFormat(addresses, patch);
  }

  function applyBorders(preset: BorderPreset, border: CellBorder | null) {
    if (!selectionBounds) return;
    const { minX, maxX, minY, maxY } = selectionBounds;
    // For each preset, decide which per-edge patch each cell gets. We batch
    // by issuing one `setCellFormat` call per "patch shape" since the
    // mutation merges into the existing format and is idempotent.
    type EdgePatch = Pick<
      import("@/liveblocks.config").CellFormat,
      "borderTop" | "borderRight" | "borderBottom" | "borderLeft"
    >;
    const cellPatches = new Map<string, EdgePatch>();
    function patchFor(x: number, y: number): EdgePatch {
      const col = colIds[x];
      const row = rowIds[y];
      if (!col || !row) return {};
      const key = `${col}@${row}`;
      let p = cellPatches.get(key);
      if (!p) {
        p = {};
        cellPatches.set(key, p);
      }
      return p;
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = patchFor(x, y);
        const isTopEdge = y === minY;
        const isBottomEdge = y === maxY;
        const isLeftEdge = x === minX;
        const isRightEdge = x === maxX;
        const isOnlyOneCol = minX === maxX;
        const isOnlyOneRow = minY === maxY;
        switch (preset) {
          case "all":
            p.borderTop = border ?? undefined;
            p.borderRight = border ?? undefined;
            p.borderBottom = border ?? undefined;
            p.borderLeft = border ?? undefined;
            break;
          case "none":
            // Setting all edges to undefined erases (the mutation strips
            // explicit undefineds — see useSetCellFormat).
            p.borderTop = undefined;
            p.borderRight = undefined;
            p.borderBottom = undefined;
            p.borderLeft = undefined;
            break;
          case "outer":
            if (isTopEdge) p.borderTop = border ?? undefined;
            if (isBottomEdge) p.borderBottom = border ?? undefined;
            if (isLeftEdge) p.borderLeft = border ?? undefined;
            if (isRightEdge) p.borderRight = border ?? undefined;
            break;
          case "inner":
            // Inner horizontal edges go on each row's bottom EXCEPT last.
            if (!isBottomEdge && !isOnlyOneRow) {
              p.borderBottom = border ?? undefined;
            }
            // Inner vertical edges go on each col's right EXCEPT last.
            if (!isRightEdge && !isOnlyOneCol) {
              p.borderRight = border ?? undefined;
            }
            break;
          case "top":
            if (isTopEdge) p.borderTop = border ?? undefined;
            break;
          case "bottom":
            if (isBottomEdge) p.borderBottom = border ?? undefined;
            break;
          case "left":
            if (isLeftEdge) p.borderLeft = border ?? undefined;
            break;
          case "right":
            if (isRightEdge) p.borderRight = border ?? undefined;
            break;
        }
      }
    }
    // Group by patch-shape signature, issue one mutation per group.
    const groups = new Map<string, string[]>();
    for (const [cellId, patch] of cellPatches) {
      const sig = JSON.stringify(patch);
      let bucket = groups.get(sig);
      if (!bucket) {
        bucket = [];
        groups.set(sig, bucket);
      }
      bucket.push(cellId);
    }
    for (const [sig, cellIdList] of groups) {
      const patch = JSON.parse(sig) as EdgePatch;
      const addresses = cellIdList.map((id) => {
        const at = id.indexOf("@");
        return { columnId: id.slice(0, at), rowId: id.slice(at + 1) };
      });
      setCellFormat(addresses, patch);
    }
  }

  // ── Format painter ────────────────────────────────────────────────────────
  // When `painterFormat` is non-null, the next cell mousedown applies that
  // captured format to the clicked cell (or dragged range) instead of
  // re-anchoring the selection. Escape cancels.
  const [painterFormat, setPainterFormat] = useState<CellFormat | null>(null);
  const togglePainter = useCallback(() => {
    if (painterFormat) {
      setPainterFormat(null);
      return;
    }
    // Capture the active cell's format. An empty/missing format still
    // captures (effectively a "reset to defaults" painter).
    setPainterFormat(activeFormat ?? {});
  }, [painterFormat, activeFormat]);

  // ── Find / replace ────────────────────────────────────────────────────────
  const [findOpen, setFindOpen] = useState(false);
  const [findShowReplace, setFindShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findReplacement, setFindReplacement] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findUseRegex, setFindUseRegex] = useState(false);
  const [findIndex, setFindIndex] = useState(0);

  const findMatches: FindMatch[] = useMemo(() => {
    if (!findOpen || findQuery === "") return [];
    let test: (s: string) => boolean;
    try {
      if (findUseRegex) {
        const re = new RegExp(findQuery, findCaseSensitive ? "" : "i");
        test = (s) => re.test(s);
      } else if (findCaseSensitive) {
        test = (s) => s.includes(findQuery);
      } else {
        const q = findQuery.toLowerCase();
        test = (s) => s.toLowerCase().includes(q);
      }
    } catch {
      return [];
    }
    const out: FindMatch[] = [];
    // Scan in display order (row-major) so prev/next traversal makes sense.
    for (const row of rows) {
      for (const col of columns) {
        const id = encodeCellId(col.id, row.id);
        const raw = rawCellsByKey.get(id);
        if (!raw) continue;
        // Search the rendered value too, so users can find what they SEE.
        const evaluated = cellGraph.get(id);
        const rendered =
          evaluated?.type === "number"
            ? String(evaluated.value)
            : evaluated?.type === "string"
              ? evaluated.value
              : "";
        if (test(raw) || test(rendered)) {
          out.push({ columnId: col.id, rowId: row.id });
        }
      }
    }
    return out;
  }, [
    findOpen,
    findQuery,
    findCaseSensitive,
    findUseRegex,
    columns,
    rows,
    rawCellsByKey,
    cellGraph,
  ]);
  useEffect(() => {
    setFindIndex((i) => (findMatches.length === 0 ? 0 : Math.min(i, findMatches.length - 1)));
  }, [findMatches.length]);

  // Selection follows the active match so navigation feels natural.
  useEffect(() => {
    const m = findMatches[findIndex];
    if (!m) return;
    setSelection({
      start: { columnId: m.columnId, rowId: m.rowId },
      end: { columnId: m.columnId, rowId: m.rowId },
    });
  }, [findMatches, findIndex]);

  const matchKeys = useMemo(
    () => new Set(findMatches.map((m) => encodeCellId(m.columnId, m.rowId))),
    [findMatches],
  );
  const activeMatchKey = useMemo(() => {
    const m = findMatches[findIndex];
    return m ? encodeCellId(m.columnId, m.rowId) : null;
  }, [findMatches, findIndex]);

  function replaceOneAt(index: number) {
    const m = findMatches[index];
    if (!m) return;
    const id = encodeCellId(m.columnId, m.rowId);
    const raw = rawCellsByKey.get(id) ?? "";
    const next = applyReplacement(raw, findQuery, findReplacement, {
      caseSensitive: findCaseSensitive,
      useRegex: findUseRegex,
    });
    if (next === raw) return;
    setCellValue(m.columnId, m.rowId, next);
  }
  function replaceCurrent() {
    replaceOneAt(findIndex);
  }
  function replaceAll() {
    for (let i = 0; i < findMatches.length; i++) replaceOneAt(i);
  }

  // ── Mouse / drag selection ────────────────────────────────────────────────
  function onCellMouseDown(
    columnId: string,
    rowId: string,
    e: React.MouseEvent,
  ) {
    if (edition) return;
    // Format painter consumes the click: apply captured format to the cell,
    // then disarm. Mid-drag during painting also paints — see mouseEnter.
    if (painterFormat) {
      setCellFormat([{ columnId, rowId }], painterFormat);
      // Keep painter active during a drag — release on mouseup below.
      draggingRef.current = "select";
      return;
    }
    if (e.shiftKey && selection) {
      setSelection({ start: selection.start, end: { columnId, rowId } });
    } else {
      setSingle(columnId, rowId);
    }
    draggingRef.current = "select";
  }

  function onCellMouseEnter(
    columnId: string,
    rowId: string,
    e: React.MouseEvent,
  ) {
    if (e.buttons === 0) {
      draggingRef.current = null;
      fillingRef.current = false;
      return;
    }
    if (fillingRef.current && autoFillState) {
      setAutoFillState({
        ...autoFillState,
        target: { columnId, rowId },
      });
      return;
    }
    // While painter is active and the mouse is down, paint every cell the
    // pointer crosses (range painting).
    if (painterFormat && draggingRef.current === "select") {
      setCellFormat([{ columnId, rowId }], painterFormat);
      return;
    }
    if (draggingRef.current !== "select" || !selection) return;
    setSelection({ start: selection.start, end: { columnId, rowId } });
  }

  useEffect(() => {
    function stop() {
      // If we were filling, commit the AutoFill mutation now.
      if (fillingRef.current && autoFillState) {
        const { seed, target } = autoFillState;
        const sx = colIndex(seed.start.columnId);
        const sy = rowIndex(seed.start.rowId);
        const ex = colIndex(seed.end.columnId);
        const ey = rowIndex(seed.end.rowId);
        const tx = colIndex(target.columnId);
        const ty = rowIndex(target.rowId);
        // The fill target rectangle extends FROM the seed top-left TO the
        // furthest-out corner the user dragged to. Constrain to one axis at
        // a time: whichever movement was larger wins.
        const dx = tx - ex;
        const dy = ty - ey;
        if (dx > 0 || dy > 0 || tx < sx || ty < sy) {
          const targetMinX = Math.min(sx, tx);
          const targetMaxX = Math.max(ex, tx);
          const targetMinY = Math.min(sy, ty);
          const targetMaxY = Math.max(ey, ty);
          const tlCol = colIds[targetMinX];
          const tlRow = rowIds[targetMinY];
          const brCol = colIds[targetMaxX];
          const brRow = rowIds[targetMaxY];
          if (tlCol && tlRow && brCol && brRow) {
            autoFill(
              seed.start,
              seed.end,
              { columnId: tlCol, rowId: tlRow },
              { columnId: brCol, rowId: brRow },
            );
            // After fill, select the union as the new selection.
            setSelection({
              start: { columnId: tlCol, rowId: tlRow },
              end: { columnId: brCol, rowId: brRow },
            });
          }
        }
      }
      // Format painter is single-shot per click/drag. Disarm on mouseup so
      // it doesn't keep painting on subsequent clicks. Matches Sheets' UX.
      if (painterFormat) setPainterFormat(null);
      draggingRef.current = null;
      fillingRef.current = false;
      setAutoFillState(null);
    }
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, [
    autoFillState,
    autoFill,
    colIds,
    rowIds,
    colIndex,
    rowIndex,
    painterFormat,
  ]);

  function onCellDoubleClick(columnId: string, rowId: string) {
    setEdition({ columnId, rowId, seed: null });
  }

  function onFillStart() {
    if (!selection || !selectionBounds) return;
    fillingRef.current = true;
    setAutoFillState({
      seed: {
        start: {
          columnId: colIds[selectionBounds.minX]!,
          rowId: rowIds[selectionBounds.minY]!,
        },
        end: {
          columnId: colIds[selectionBounds.maxX]!,
          rowId: rowIds[selectionBounds.maxY]!,
        },
      },
      target: {
        columnId: colIds[selectionBounds.maxX]!,
        rowId: rowIds[selectionBounds.maxY]!,
      },
    });
  }

  // ── Header click → select whole column/row ─────────────────────────────────
  function onSelectColumn(index: number, shiftKey: boolean) {
    const col = colIds[index];
    if (!col || rowIds.length === 0) return;
    const first = rowIds[0]!;
    const last = rowIds[rowIds.length - 1]!;
    if (shiftKey && selection) {
      setSelection({
        start: selection.start,
        end: { columnId: col, rowId: last },
      });
    } else {
      setSelection({
        start: { columnId: col, rowId: first },
        end: { columnId: col, rowId: last },
      });
    }
  }
  function onSelectRow(index: number, shiftKey: boolean) {
    const row = rowIds[index];
    if (!row || colIds.length === 0) return;
    const first = colIds[0]!;
    const last = colIds[colIds.length - 1]!;
    if (shiftKey && selection) {
      setSelection({
        start: selection.start,
        end: { columnId: last, rowId: row },
      });
    } else {
      setSelection({
        start: { columnId: first, rowId: row },
        end: { columnId: last, rowId: row },
      });
    }
  }

  // ── Commit edit ───────────────────────────────────────────────────────────
  const commitEdit = useCallback(
    (
      value: string,
      advance: "down" | "right" | "up" | "left" | null,
    ) => {
      if (!edition) return;
      setCellValue(edition.columnId, edition.rowId, value);
      const x = colIndex(edition.columnId);
      const y = rowIndex(edition.rowId);
      setEdition(null);
      if (!advance) return;
      let nx = x;
      let ny = y;
      if (advance === "down") ny = Math.min(rowIds.length - 1, y + 1);
      if (advance === "up") ny = Math.max(0, y - 1);
      if (advance === "right") nx = Math.min(colIds.length - 1, x + 1);
      if (advance === "left") nx = Math.max(0, x - 1);
      const nextCol = colIds[nx];
      const nextRow = rowIds[ny];
      if (nextCol && nextRow) setSingle(nextCol, nextRow);
    },
    [edition, setCellValue, colIndex, rowIndex, colIds, rowIds, setSingle],
  );

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (edition) return;
    const key = e.key;
    const meta = e.metaKey || e.ctrlKey;

    // Escape disarms the format painter before any other handling.
    if (key === "Escape" && painterFormat) {
      e.preventDefault();
      setPainterFormat(null);
      return;
    }

    if (meta && (key === "z" || key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (meta && key === "y") {
      e.preventDefault();
      history.redo();
      return;
    }
    if (meta && (key === "=" || key === "+")) {
      e.preventDefault();
      zoomIn();
      return;
    }
    if (meta && key === "-") {
      e.preventDefault();
      zoomOut();
      return;
    }
    if (meta && key === "0") {
      e.preventDefault();
      zoomReset();
      return;
    }
    if (meta && (key === "f" || key === "F")) {
      e.preventDefault();
      setFindOpen(true);
      setFindShowReplace(false);
      return;
    }
    if (meta && (key === "h" || key === "H")) {
      e.preventDefault();
      setFindOpen(true);
      setFindShowReplace(true);
      return;
    }
    // `?` (Shift+/) — open shortcuts modal. Plain `?` triggers when not
    // editing AND no modifier — otherwise typing `?` in a cell should
    // start editing with that key, which we handle later.
    if (key === "?" && !meta && !e.altKey && !selection) {
      e.preventDefault();
      setShortcutsOpen(true);
      return;
    }
    if (!selection) return;
    if (meta && (key === "b" || key === "B")) {
      e.preventDefault();
      formatPatch({ bold: !activeFormat?.bold ? true : undefined });
      return;
    }
    if (meta && (key === "i" || key === "I")) {
      e.preventDefault();
      formatPatch({ italic: !activeFormat?.italic ? true : undefined });
      return;
    }
    if (meta && (key === "u" || key === "U")) {
      e.preventDefault();
      formatPatch({ underline: !activeFormat?.underline ? true : undefined });
      return;
    }
    if (meta && (key === "a" || key === "A")) {
      e.preventDefault();
      const c0 = colIds[0];
      const cN = colIds[colIds.length - 1];
      const r0 = rowIds[0];
      const rN = rowIds[rowIds.length - 1];
      if (c0 && cN && r0 && rN) {
        setSelection({
          start: { columnId: c0, rowId: r0 },
          end: { columnId: cN, rowId: rN },
        });
      }
      return;
    }

    if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
      e.preventDefault();
      const focus = selection.end;
      let nx = colIndex(focus.columnId);
      let ny = rowIndex(focus.rowId);
      if (key === "ArrowUp") ny = Math.max(0, ny - 1);
      if (key === "ArrowDown") ny = Math.min(rowIds.length - 1, ny + 1);
      if (key === "ArrowLeft") nx = Math.max(0, nx - 1);
      if (key === "ArrowRight") nx = Math.min(colIds.length - 1, nx + 1);
      const nextCol = colIds[nx];
      const nextRow = rowIds[ny];
      if (!nextCol || !nextRow) return;
      if (e.shiftKey) {
        setSelection({
          start: selection.start,
          end: { columnId: nextCol, rowId: nextRow },
        });
      } else {
        setSingle(nextCol, nextRow);
      }
      return;
    }

    if (key === "Enter") {
      e.preventDefault();
      setEdition({
        columnId: selection.start.columnId,
        rowId: selection.start.rowId,
        seed: null,
      });
      return;
    }

    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      const targets = enumerateRange(selectionBounds, colIds, rowIds);
      if (targets.length > 0) clearCells(targets);
      return;
    }

    if (key === "Tab") {
      e.preventDefault();
      const focus = selection.end;
      const x = colIndex(focus.columnId);
      const y = rowIndex(focus.rowId);
      const nx = e.shiftKey
        ? Math.max(0, x - 1)
        : Math.min(colIds.length - 1, x + 1);
      const nextCol = colIds[nx];
      const nextRow = rowIds[y];
      if (nextCol && nextRow) setSingle(nextCol, nextRow);
      return;
    }

    // Type-to-edit.
    if (!meta && !e.altKey && key.length === 1 && !e.repeat) {
      e.preventDefault();
      setEdition({
        columnId: selection.start.columnId,
        rowId: selection.start.rowId,
        seed: key,
      });
      return;
    }
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────
  function onCopy(e: React.ClipboardEvent) {
    if (edition) return;
    if (!selectionBounds) return;
    e.preventDefault();
    const tsv = serializeRange(selectionBounds, colIds, rowIds, rawCellsByKey);
    e.clipboardData.setData("text/plain", tsv);
  }
  function onPaste(e: React.ClipboardEvent) {
    if (edition || !selection) return;
    e.preventDefault();
    const matrix = parseTsv(e.clipboardData.getData("text/plain"));
    if (matrix.length === 0) return;
    const topLeft = selectionBounds
      ? {
          columnId: colIds[selectionBounds.minX]!,
          rowId: rowIds[selectionBounds.minY]!,
        }
      : { columnId: selection.start.columnId, rowId: selection.start.rowId };
    pasteRange(topLeft, matrix);
  }
  function onCut(e: React.ClipboardEvent) {
    if (edition || !selectionBounds) return;
    e.preventDefault();
    const tsv = serializeRange(selectionBounds, colIds, rowIds, rawCellsByKey);
    e.clipboardData.setData("text/plain", tsv);
    const targets = enumerateRange(selectionBounds, colIds, rowIds);
    if (targets.length > 0) clearCells(targets);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const rootStyle: CSSProperties = {
    ["--hc-sheet-selection" as string]: myColor,
  };
  const tableContainerStyle: CSSProperties = {
    transform: `scale(${zoom})`,
    transformOrigin: "top left",
    // Avoid the unscaled phantom area from breaking scroll. width compensates.
    width: `${100 / zoom}%`,
    // The fill-drag preview overlay positions absolutely against this box.
    position: "relative",
  };

  const fillCornerId = useMemo(() => {
    if (!selectionBounds) return null;
    const col = colIds[selectionBounds.maxX];
    const row = rowIds[selectionBounds.maxY];
    if (!col || !row) return null;
    return encodeCellId(col, row);
  }, [selectionBounds, colIds, rowIds]);

  /**
   * Pixel rectangle of the fill preview — the union of seed + drag target,
   * shown as a dashed border while the user drags the AutoFill handle.
   *
   * Returns `null` when there's no fill in progress, or when the cursor is
   * still inside the seed (no preview until the user actually extends the
   * range). Layout is in unscaled CSS pixels; the parent table is wrapped in
   * a `transform: scale(zoom)` div so the overlay inherits the same scale.
   */
  const fillPreviewRect = useMemo(() => {
    if (!autoFillState) return null;
    const sx = colIndex(autoFillState.seed.start.columnId);
    const sy = rowIndex(autoFillState.seed.start.rowId);
    const ex = colIndex(autoFillState.seed.end.columnId);
    const ey = rowIndex(autoFillState.seed.end.rowId);
    const tx = colIndex(autoFillState.target.columnId);
    const ty = rowIndex(autoFillState.target.rowId);
    if (sx < 0 || sy < 0 || ex < 0 || ey < 0 || tx < 0 || ty < 0) return null;
    // No preview if the cursor hasn't left the seed yet.
    if (tx >= sx && tx <= ex && ty >= sy && ty <= ey) return null;
    const minX = Math.min(sx, tx);
    const maxX = Math.max(ex, tx);
    const minY = Math.min(sy, ty);
    const maxY = Math.max(ey, ty);
    let left = ROW_HEADER_WIDTH;
    for (let i = 0; i < minX; i++) left += columns[i]?.width ?? 0;
    let top = COLUMN_HEADER_HEIGHT;
    for (let i = 0; i < minY; i++) top += rows[i]?.height ?? 0;
    let width = 0;
    for (let i = minX; i <= maxX; i++) width += columns[i]?.width ?? 0;
    let height = 0;
    for (let i = minY; i <= maxY; i++) height += rows[i]?.height ?? 0;
    return { left, top, width, height };
  }, [autoFillState, colIndex, rowIndex, columns, rows]);

  return (
    <div
      className="hc-sheet-root flex h-full min-h-0 flex-col"
      style={rootStyle}
      data-painter={painterFormat ? "true" : undefined}
    >
      <SheetFormulaBar
        cellLabel={activeCellLabel}
        rawDisplay={activeRawDisplay}
        disabled={!selection || !!edition}
        onCommit={formulaBarCommit}
      />
      <SheetFormatToolbar
        activeFormat={activeFormat}
        hasSelection={!!selectionBounds}
        onPatch={formatPatch}
        painterActive={!!painterFormat}
        onTogglePainter={togglePainter}
        onApplyBorders={applyBorders}
        onMerge={mergeSelection}
        onUnmerge={unmergeSelection}
        canMerge={
          !!selectionBounds &&
          (selectionBounds.minX !== selectionBounds.maxX ||
            selectionBounds.minY !== selectionBounds.maxY)
        }
        canUnmerge={(() => {
          if (!selectionBounds) return false;
          const tlCol = colIds[selectionBounds.minX];
          const tlRow = rowIds[selectionBounds.minY];
          if (!tlCol || !tlRow) return false;
          return mergeSpans.has(encodeCellId(tlCol, tlRow));
        })()}
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/60 px-4 py-1.5">
        {/* Convenience wrappers for the per-header dropdown's "Insert
            column/row" actions. The main button mirrors "Insert column
            right" / "Insert row below" anchored on the currently-selected
            cell; the attached chevron exposes the "left" / "above" variant.
            With no selection we fall back to appending at the end so the
            buttons are still useful. */}
        <InsertColumnSplitButton
          selectedColIndex={selection ? colIndex(selection.start.columnId) : -1}
          totalColumns={columns.length}
          onInsert={insertColumn}
        />
        <InsertRowSplitButton
          selectedRowIndex={selection ? rowIndex(selection.start.rowId) : -1}
          totalRows={rows.length}
          onInsert={insertRow}
        />
        <FileMenuButton
          onExportCsv={exportActiveSheetCsv}
          onExportTsv={exportActiveSheetTsv}
          onExportXlsx={exportWorkbookXlsx}
          onImport={triggerImport}
          onPrint={() => window.print()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xls,.ods"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            // Reset so importing the same file twice in a row works.
            e.target.value = "";
          }}
        />
        <InsertChartButton
          disabled={!selectionBounds}
          onInsert={(type) => insertChart(type)}
          onInsertSparkline={(kind) => insertSparkline(kind)}
        />
        <DataToolsButton
          hasSelection={!!selectionBounds}
          sheetIsProtected={!!activeSheet?.protected}
          existingRules={
            activeSheet?.conditionalRules
              ? (Object.values(activeSheet.conditionalRules) as ConditionalRule[])
              : []
          }
          onConditionalFormat={addQuickConditionalRule}
          onDeleteConditionalRule={deleteConditionalRule}
          onSetValidation={applyValidation}
          onToggleProtect={() => {
            if (activeSheetId) toggleProtectRaw(activeSheetId);
          }}
          onRemoveDuplicates={removeDuplicatesInSelection}
        />
        <NewCellCommentButton
          sheetId={activeSheetId || ""}
          cellId={
            selection
              ? encodeCellId(
                  selection.start.columnId,
                  selection.start.rowId,
                )
              : null
          }
        />
        <CommentsSidebarButton
          sheetTitles={sheetTitlesMap}
          onSwitchToCell={switchToCellAcrossSheets}
        />
        <NamedRangesPopover
          ranges={namedRangeRows}
          hasSelection={!!selectionBounds && !!activeSheetId}
          selectionDisplay={namedRangeSelectionDisplay}
          onAdd={(name) => {
            if (!selectionBounds || !activeSheetId) return;
            const startRef = encodeCellId(
              colIds[selectionBounds.minX]!,
              rowIds[selectionBounds.minY]!,
            );
            const endRef = encodeCellId(
              colIds[selectionBounds.maxX]!,
              rowIds[selectionBounds.maxY]!,
            );
            addNamedRange(name, activeSheetId, startRef, endRef);
          }}
          onDelete={(name) => deleteNamedRange(name)}
        />
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => history.undo()}
            title="Undo (Cmd+Z)"
            className="size-7"
            disabled={!canUndo}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => history.redo()}
            title="Redo (Cmd+Shift+Z)"
            className="size-7"
            disabled={!canRedo}
          >
            <Redo2 className="size-4" />
          </Button>
          <span className="mx-1 h-5 w-px self-center bg-border/80" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={zoomOut}
            title="Zoom out (Cmd+−)"
            className={cn("h-7 px-2 text-sm")}
            disabled={zoom <= ZOOM_MIN + 0.001}
          >
            −
          </Button>
          <button
            type="button"
            onClick={zoomReset}
            title="Reset zoom (Cmd+0)"
            className="w-12 select-none rounded-md px-1 text-center text-sm tabular-nums text-muted-foreground transition-colors hover:bg-accent"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={zoomIn}
            title="Zoom in (Cmd+=)"
            className={cn("h-7 px-2 text-sm")}
            disabled={zoom >= ZOOM_MAX - 0.001}
          >
            +
          </Button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        {findOpen ? (
          <SheetFindReplace
            query={findQuery}
            replacement={findReplacement}
            caseSensitive={findCaseSensitive}
            useRegex={findUseRegex}
            matches={findMatches}
            activeMatchIndex={findIndex}
            showReplace={findShowReplace}
            onChangeQuery={setFindQuery}
            onChangeReplacement={setFindReplacement}
            onToggleCase={() => setFindCaseSensitive((v) => !v)}
            onToggleRegex={() => setFindUseRegex((v) => !v)}
            onPrev={() =>
              setFindIndex((i) =>
                findMatches.length === 0
                  ? 0
                  : (i - 1 + findMatches.length) % findMatches.length,
              )
            }
            onNext={() =>
              setFindIndex((i) =>
                findMatches.length === 0 ? 0 : (i + 1) % findMatches.length,
              )
            }
            onReplaceOne={replaceCurrent}
            onReplaceAll={replaceAll}
            onClose={() => setFindOpen(false)}
          />
        ) : null}
        <HeadersDnd
          axis="column"
          ids={colIds}
          onMove={(from, to) => moveColumn(from, to)}
        >
          <HeadersDnd
            axis="row"
            ids={rowIds}
            onMove={(from, to) => moveRow(from, to)}
          >
            <div
              ref={scrollRef}
              className="hc-sheet-scroll"
              tabIndex={0}
              onKeyDown={onKeyDown}
              onCopy={onCopy}
              onPaste={onPaste}
              onCut={onCut}
              // touch-action: pan-x pan-y leaves native scroll intact while
              // letting usePinch claim multi-touch pinch gestures.
              style={{ touchAction: "pan-x pan-y" }}
              {...bindPinch()}
            >
              <div style={tableContainerStyle}>
                <table
                  className="hc-sheet-table"
                  style={tableStyle(visibleColumns)}
                >
                  <colgroup>
                    <col style={{ width: ROW_HEADER_WIDTH }} />
                    {visibleColumns.map((c) => (
                      <col key={c.id} style={{ width: c.width }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr style={{ height: COLUMN_HEADER_HEIGHT }}>
                      <th className="hc-sheet-corner" />
                      {visibleColumns.map((col, visIdx) => {
                        const i = col.index; // storage index
                        const isFrozenCol = visIdx < frozenColumnsCount;
                        const frozenLeft = isFrozenCol
                          ? ROW_HEADER_WIDTH + columnLeftOffsets[visIdx]!
                          : null;
                        return (
                          <th
                            key={col.id}
                            className="hc-sheet-col-header"
                            data-frozen={isFrozenCol ? "true" : undefined}
                            style={
                              isFrozenCol
                                ? { left: frozenLeft!, zIndex: 4 }
                                : undefined
                            }
                          >
                            <ColumnHandle
                              id={col.id}
                              index={i}
                              size={col.width}
                              count={columns.length}
                              onResize={(idx, w) => resizeColumn(idx, w)}
                              onInsertBefore={(idx) => insertColumn(idx)}
                              onInsertAfter={(idx) => insertColumn(idx + 1)}
                              onDelete={(idx) => deleteColumn(idx)}
                              onResizeStart={() => history.pause()}
                              onResizeEnd={() => history.resume()}
                              onSelectAxis={onSelectColumn}
                              onSort={(idx, dir) => sortColumn(idx, dir)}
                              onHide={(idx) => hideColumn(idx)}
                              onFreezeUpTo={(idx) => freezeColumns(idx + 1)}
                              onUnfreeze={() => freezeColumns(0)}
                              isFrozen={(activeSheet?.frozenColumns ?? 0) > 0}
                              onGroup={(idx) => {
                                if (!activeSheetId) return;
                                const colId = columns[idx]?.id;
                                if (colId)
                                  setGroupLevelRaw(
                                    activeSheetId,
                                    "col",
                                    colId,
                                    1,
                                  );
                              }}
                              onUngroup={(idx) => {
                                if (!activeSheetId) return;
                                const colId = columns[idx]?.id;
                                if (colId)
                                  setGroupLevelRaw(
                                    activeSheetId,
                                    "col",
                                    colId,
                                    0,
                                  );
                              }}
                              isGrouped={
                                !!(activeSheet?.groupLevelsCol?.[col.id]) &&
                                (activeSheet.groupLevelsCol[col.id] ?? 0) > 0
                              }
                            />
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, visRowIdx) => {
                      const y = row.index;
                      const isFrozenRow = visRowIdx < frozenRowsCount;
                      const frozenTop = isFrozenRow
                        ? COLUMN_HEADER_HEIGHT + rowTopOffsets[visRowIdx]!
                        : null;
                      return (
                      <tr key={row.id} style={{ height: row.height }}>
                        <th
                          className="hc-sheet-row-header"
                          data-frozen={isFrozenRow ? "true" : undefined}
                          style={
                            isFrozenRow
                              ? { top: frozenTop!, zIndex: 4 }
                              : undefined
                          }
                        >
                          <RowHandle
                            id={row.id}
                            index={y}
                            size={row.height}
                            count={rows.length}
                            onResize={(idx, h) => resizeRow(idx, h)}
                            onInsertBefore={(idx) => insertRow(idx)}
                            onInsertAfter={(idx) => insertRow(idx + 1)}
                            onDelete={(idx) => deleteRow(idx)}
                            onResizeStart={() => history.pause()}
                            onResizeEnd={() => history.resume()}
                            onSelectAxis={onSelectRow}
                            onHide={(idx) => hideRow(idx)}
                            onFreezeUpTo={(idx) => freezeRows(idx + 1)}
                            onUnfreeze={() => freezeRows(0)}
                            isFrozen={(activeSheet?.frozenRows ?? 0) > 0}
                            onGroup={(idx) => {
                              if (!activeSheetId) return;
                              const rowId = rows[idx]?.id;
                              if (rowId)
                                setGroupLevelRaw(
                                  activeSheetId,
                                  "row",
                                  rowId,
                                  1,
                                );
                            }}
                            onUngroup={(idx) => {
                              if (!activeSheetId) return;
                              const rowId = rows[idx]?.id;
                              if (rowId)
                                setGroupLevelRaw(
                                  activeSheetId,
                                  "row",
                                  rowId,
                                  0,
                                );
                            }}
                            isGrouped={
                              !!(activeSheet?.groupLevelsRow?.[row.id]) &&
                              (activeSheet.groupLevelsRow[row.id] ?? 0) > 0
                            }
                          />
                        </th>
                        {visibleColumns.map((col, visIdx) => {
                          const id = encodeCellId(col.id, row.id);
                          // Merged child cells render nothing — they're
                          // covered by the top-left cell's colSpan/rowSpan.
                          if (mergeHidden.has(id)) return null;
                          const isFrozenCol = visIdx < frozenColumnsCount;
                          const cellLeft = isFrozenCol
                            ? ROW_HEADER_WIDTH + columnLeftOffsets[visIdx]!
                            : null;
                          const cellTop = isFrozenRow
                            ? COLUMN_HEADER_HEIGHT + rowTopOffsets[visRowIdx]!
                            : null;
                          const span = mergeSpans.get(id);
                          const entry = cells?.[id];
                          const raw = entry?.value ?? "";
                          const evaluated: ExpressionResult =
                            cellGraph.get(id) ?? { type: "string", value: "" };
                          const isSelected =
                            selection != null &&
                            selection.start.columnId === col.id &&
                            selection.start.rowId === row.id;
                          const isInRange = isInsideBounds(
                            selectionBounds,
                            colIndex(col.id),
                            rowIndex(row.id),
                          );
                          const isEditing =
                            edition != null &&
                            edition.columnId === col.id &&
                            edition.rowId === row.id;
                          const other = othersByCell.get(id);
                          const displayFormula = raw.startsWith("=")
                            ? unwriteRefsToA1(raw, colIds, rowIds)
                            : raw;
                          return (
                            <SheetCell
                              key={col.id}
                              columnId={col.id}
                              rowId={row.id}
                              rawValue={raw}
                              displayFormula={displayFormula}
                              evaluated={evaluated}
                              format={
                                conditionalOverrides.has(id)
                                  ? { ...entry?.format, ...conditionalOverrides.get(id)! }
                                  : entry?.format
                              }
                              validation={validations.get(id)}
                              isSelected={isSelected}
                              isInRange={isInRange}
                              isEditing={isEditing}
                              isMatch={matchKeys.has(id)}
                              isActiveMatch={activeMatchKey === id}
                              isFillCorner={fillCornerId === id}
                              hasComment={cellsWithComments.has(id)}
                              colSpan={span?.colSpan}
                              rowSpan={span?.rowSpan}
                              other={!isSelected ? other : undefined}
                              editSeed={
                                isEditing
                                  ? (edition?.seed ?? undefined)
                                  : undefined
                              }
                              frozenLeft={cellLeft}
                              frozenTop={cellTop}
                              onMouseDown={(e) =>
                                onCellMouseDown(col.id, row.id, e)
                              }
                              onMouseEnter={(e) =>
                                onCellMouseEnter(col.id, row.id, e)
                              }
                              onContextMenu={(e) => {
                                e.preventDefault();
                                // Make sure the clicked cell becomes the
                                // anchor so menu actions operate on it.
                                if (
                                  !selection ||
                                  selection.start.columnId !== col.id ||
                                  selection.start.rowId !== row.id
                                ) {
                                  setSingle(col.id, row.id);
                                }
                                setContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  columnId: col.id,
                                  rowId: row.id,
                                });
                              }}
                              onDoubleClick={() =>
                                onCellDoubleClick(col.id, row.id)
                              }
                              onCommit={commitEdit}
                              onCancel={() => setEdition(null)}
                              onFillStart={onFillStart}
                            />
                          );
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {fillPreviewRect ? (
                  <div
                    aria-hidden
                    className="hc-sheet-fill-preview"
                    style={{
                      left: fillPreviewRect.left,
                      top: fillPreviewRect.top,
                      width: fillPreviewRect.width,
                      height: fillPreviewRect.height,
                    }}
                  />
                ) : null}
                {/*
                  Charts overlay. Positioned inside the table-container div so
                  it scrolls + zooms with the grid. Coordinates are in CSS
                  pixels relative to the table's top-left.
                */}
                <SheetChartsLayer
                  charts={chartsList}
                  activeSheetId={activeSheetId}
                  cellValues={rawCellsByKey}
                  columnIds={colIds}
                  rowIds={rowIds}
                  onUpdate={(id, patch) => updateChartRaw(id, patch)}
                  onDelete={(id) => deleteChartRaw(id)}
                />
              </div>
            </div>
          </HeadersDnd>
        </HeadersDnd>
      </div>
      {shortcutsOpen ? (
        <SheetShortcutsModal onClose={() => setShortcutsOpen(false)} />
      ) : null}
      {contextMenu ? (
        <SheetContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sections={buildContextMenu(
            { columnId: contextMenu.columnId, rowId: contextMenu.rowId },
            colIndex(contextMenu.columnId),
            rowIndex(contextMenu.rowId),
            {
              insertColumn,
              insertRow,
              deleteColumn,
              deleteRow,
              clearSelection: () => {
                const targets = enumerateRange(selectionBounds, colIds, rowIds);
                if (targets.length > 0) clearCells(targets);
              },
              copy: () => document.execCommand("copy"),
              cut: () => document.execCommand("cut"),
              paste: async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (!text || !selection) return;
                  const matrix = text
                    .replace(/\r\n?/g, "\n")
                    .split("\n")
                    .map((l) => l.split("\t"));
                  pasteRange(
                    {
                      columnId: selection.start.columnId,
                      rowId: selection.start.rowId,
                    },
                    matrix,
                  );
                } catch {
                  // Clipboard read may require user gesture; the keyboard
                  // shortcut path already works without this.
                }
              },
              insertComment: () => {
                // Surface this via the toolbar's New Comment button — the
                // composer is already wired there. We just open it as the
                // visual focus is on the selected cell.
                document
                  .querySelector<HTMLButtonElement>(
                    '[title^="Insert comment"]',
                  )
                  ?.click();
              },
              insertSparkline: () => insertSparkline("line"),
            },
          )}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
      <SheetTabBar
        sheets={sheetsList.map((s) => ({
          id: s.id,
          title: s.title,
          color: s.color,
        }))}
        activeSheetId={activeSheetId}
        onSelect={switchSheet}
        onAdd={() => addSheet()}
        onRename={(id, title) => renameSheet(id, title)}
        onDuplicate={(id) => duplicateSheet(id)}
        onDelete={(id) => deleteSheet(id)}
        onReorder={(from, to) => reorderSheet(from, to)}
        onSetColor={(id, c) => setSheetColor(id, c)}
        viewersBySheet={viewersBySheet}
      />
    </div>
  );
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function tableStyle(
  columns: ReadonlyArray<{ width: number }>,
): CSSProperties {
  const total =
    ROW_HEADER_WIDTH +
    columns.reduce((acc, c) => acc + (c.width || COLUMN_DEFAULT_WIDTH), 0);
  return { width: total };
}

function isInsideBounds(
  bounds: { minX: number; maxX: number; minY: number; maxY: number } | null,
  x: number,
  y: number,
): boolean {
  if (!bounds) return false;
  return (
    x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY
  );
}

function enumerateRange(
  bounds: { minX: number; maxX: number; minY: number; maxY: number } | null,
  colIds: string[],
  rowIds: string[],
): SheetCellAddress[] {
  if (!bounds) return [];
  const out: SheetCellAddress[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    const rowId = rowIds[y];
    if (!rowId) continue;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const colId = colIds[x];
      if (!colId) continue;
      out.push({ columnId: colId, rowId });
    }
  }
  return out;
}

function serializeRange(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  colIds: string[],
  rowIds: string[],
  rawByKey: Map<string, string>,
): string {
  const lines: string[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    const rowId = rowIds[y];
    if (!rowId) {
      lines.push("");
      continue;
    }
    const cells: string[] = [];
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const colId = colIds[x];
      const raw = colId ? (rawByKey.get(encodeCellId(colId, rowId)) ?? "") : "";
      cells.push(raw.replace(/[\t\r\n]+/g, " "));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

function parseTsv(raw: string): string[][] {
  if (raw.length === 0) return [];
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

function applyReplacement(
  raw: string,
  needle: string,
  replacement: string,
  opts: { caseSensitive: boolean; useRegex: boolean },
): string {
  if (needle === "") return raw;
  if (opts.useRegex) {
    try {
      const re = new RegExp(needle, opts.caseSensitive ? "g" : "gi");
      return raw.replace(re, replacement);
    } catch {
      return raw;
    }
  }
  if (opts.caseSensitive) return raw.split(needle).join(replacement);
  // Case-insensitive literal replace via a constructed regex with escaped needle.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gi");
  return raw.replace(re, replacement);
}

/** Per-collaborator cursor/selection colors — the shared `--series-*` ramp
 *  (globals.css), so presence sits in the same hue family as the charts. */
const PALETTE = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

function colorFor(connectionId: number): string {
  return PALETTE[Math.abs(connectionId) % PALETTE.length]!;
}

/* -------------------------------------------------------------------------- */
/* Toolbar split buttons                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Split button for inserting a column. Click the main half to insert right
 * of the selected column (falling back to appending at the end when nothing
 * is selected, so the button always does *something*). The attached chevron
 * opens a dropdown with the "left" variant.
 */
function InsertColumnSplitButton({
  selectedColIndex,
  totalColumns,
  onInsert,
}: {
  selectedColIndex: number;
  totalColumns: number;
  onInsert: (index: number) => void;
}) {
  // -1 (no selection) → append at the end.
  const rightIndex = selectedColIndex < 0 ? totalColumns : selectedColIndex + 1;
  const leftIndex = selectedColIndex < 0 ? totalColumns : selectedColIndex;
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onInsert(rightIndex)}
        title={
          selectedColIndex < 0
            ? "Append column at the end"
            : "Insert column right of selection"
        }
        className="h-7 gap-1 rounded-r-none pr-1.5"
      >
        <Plus className="size-4" /> Column
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Column insertion options"
              className="h-7 w-5 rounded-l-none border-l border-border px-0"
            />
          }
        >
          <ChevronDown className="size-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
          <DropdownMenuItem onClick={() => onInsert(leftIndex)}>
            Insert column left
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert(rightIndex)}>
            Insert column right
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Build the right-click context menu for a cell. */
function buildContextMenu(
  cell: { columnId: string; rowId: string },
  colIdx: number,
  rowIdx: number,
  actions: {
    insertColumn: (idx: number) => void;
    insertRow: (idx: number) => void;
    deleteColumn: (idx: number) => void;
    deleteRow: (idx: number) => void;
    clearSelection: () => void;
    copy: () => void;
    cut: () => void;
    paste: () => void;
    insertComment: () => void;
    insertSparkline: () => void;
  },
): ContextMenuSection[] {
  void cell;
  return [
    {
      items: [
        { label: "Cut", shortcut: "⌘X", onClick: actions.cut },
        { label: "Copy", shortcut: "⌘C", onClick: actions.copy },
        { label: "Paste", shortcut: "⌘V", onClick: actions.paste },
      ],
    },
    {
      items: [
        {
          label: "Insert column left",
          onClick: () => actions.insertColumn(colIdx),
        },
        {
          label: "Insert column right",
          onClick: () => actions.insertColumn(colIdx + 1),
        },
        {
          label: "Insert row above",
          onClick: () => actions.insertRow(rowIdx),
        },
        {
          label: "Insert row below",
          onClick: () => actions.insertRow(rowIdx + 1),
        },
      ],
    },
    {
      items: [
        {
          label: "Delete column",
          destructive: true,
          onClick: () => actions.deleteColumn(colIdx),
        },
        {
          label: "Delete row",
          destructive: true,
          onClick: () => actions.deleteRow(rowIdx),
        },
        {
          label: "Clear contents",
          shortcut: "Del",
          onClick: actions.clearSelection,
        },
      ],
    },
    {
      items: [
        {
          label: "Insert comment",
          shortcut: "⌘⌥M",
          onClick: actions.insertComment,
        },
        {
          label: "Insert sparkline",
          onClick: actions.insertSparkline,
        },
      ],
    },
  ];
}

/** Human-readable summary of a conditional-format rule's condition. */
function describeCondition(r: ConditionalRule): string {
  const c = r.condition;
  switch (c.kind) {
    case "cellIs":
      return `value ${c.op === "eq" ? "=" : c.op === "neq" ? "≠" : c.op === "lt" ? "<" : c.op === "lte" ? "≤" : c.op === "gt" ? ">" : c.op === "gte" ? "≥" : "between"} ${c.value}${c.value2 != null ? `..${c.value2}` : ""}`;
    case "textContains":
      return `text contains "${c.value}"`;
    case "isEmpty":
      return "is empty";
    case "isNotEmpty":
      return "is not empty";
    case "isError":
      return "is error";
    case "formula":
      return `formula: ${c.expression.slice(0, 30)}${c.expression.length > 30 ? "…" : ""}`;
    case "colorScale":
      return "color scale";
  }
}

/**
 * File menu — import / export / print. Each item just delegates to a
 * surface-owned callback so the file-system access stays in one place.
 */
function FileMenuButton({
  onExportCsv,
  onExportTsv,
  onExportXlsx,
  onImport,
  onPrint,
}: {
  onExportCsv: () => void;
  onExportTsv: () => void;
  onExportXlsx: () => void;
  onImport: () => void;
  onPrint: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title="File"
            className="h-7 px-2 text-sm"
          >
            <FileDown className="size-4" /> File
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        <DropdownMenuItem onClick={onImport}>
          <Upload className="size-4" /> Import…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onExportCsv}>
          Download active sheet as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportTsv}>
          Download active sheet as TSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportXlsx}>
          Download workbook as Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onPrint}>
          <Printer className="size-4" /> Print…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Data tools popover — conditional formatting presets, data validation,
 * sheet protection toggle. A "Data" menu in Sheets' parlance.
 */
function DataToolsButton({
  hasSelection,
  sheetIsProtected,
  existingRules,
  onConditionalFormat,
  onDeleteConditionalRule,
  onSetValidation,
  onToggleProtect,
  onRemoveDuplicates,
}: {
  hasSelection: boolean;
  sheetIsProtected: boolean;
  existingRules: ConditionalRule[];
  onConditionalFormat: (
    preset:
      | "highlightGT0"
      | "highlightLT0"
      | "colorScaleRedGreen"
      | "highlightNonEmpty",
  ) => void;
  onDeleteConditionalRule: (ruleId: string) => void;
  onSetValidation: (rule: DataValidationRule | null) => void;
  onToggleProtect: () => void;
  onRemoveDuplicates: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title="Data tools"
            className="h-7 px-2 text-sm"
          >
            <Database className="size-4" /> Data
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => onConditionalFormat("highlightGT0")}
        >
          Highlight if &gt; 0 (green)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => onConditionalFormat("highlightLT0")}
        >
          Highlight if &lt; 0 (red)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => onConditionalFormat("colorScaleRedGreen")}
        >
          Color scale (red→green)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => onConditionalFormat("highlightNonEmpty")}
        >
          Highlight non-empty
        </DropdownMenuItem>
        {existingRules.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                Active rules ({existingRules.length})
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            {existingRules.map((r) => (
              <DropdownMenuItem
                key={r.id}
                onClick={() => onDeleteConditionalRule(r.id)}
              >
                <span
                  className="size-3 shrink-0 rounded-sm shadow-ring"
                  style={{
                    background: r.format.bgColor ?? "transparent",
                  }}
                />
                <span className="truncate font-mono text-xs">
                  {describeCondition(r)}
                </span>
                <span className="ml-auto text-xs text-faint-foreground">
                  Click to delete
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => onSetValidation({ kind: "checkbox" })}
        >
          Insert checkbox
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => {
            const csv = window.prompt(
              "Dropdown options (comma-separated):",
              "Yes,No,Maybe",
            );
            if (csv == null) return;
            const values = csv
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (values.length === 0) return;
            onSetValidation({ kind: "list", values });
          }}
        >
          Insert dropdown…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => {
            // eslint-disable-next-line no-alert
            const minS = window.prompt("Minimum number (blank = no min):");
            if (minS == null) return;
            // eslint-disable-next-line no-alert
            const maxS = window.prompt("Maximum number (blank = no max):");
            if (maxS == null) return;
            const min = minS === "" ? undefined : Number(minS);
            const max = maxS === "" ? undefined : Number(maxS);
            if (
              (min !== undefined && Number.isNaN(min)) ||
              (max !== undefined && Number.isNaN(max))
            )
              return;
            onSetValidation({ kind: "numberRange", min, max });
          }}
        >
          Validate: number range…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => {
            // eslint-disable-next-line no-alert
            const minS = window.prompt("Minimum date (YYYY-MM-DD, blank = no min):");
            if (minS == null) return;
            // eslint-disable-next-line no-alert
            const maxS = window.prompt("Maximum date (YYYY-MM-DD, blank = no max):");
            if (maxS == null) return;
            onSetValidation({
              kind: "dateRange",
              min: minS || undefined,
              max: maxS || undefined,
            });
          }}
        >
          Validate: date range…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => {
            // eslint-disable-next-line no-alert
            const minS = window.prompt("Minimum text length (blank = no min):");
            if (minS == null) return;
            // eslint-disable-next-line no-alert
            const maxS = window.prompt("Maximum text length (blank = no max):");
            if (maxS == null) return;
            const min = minS === "" ? undefined : Number(minS);
            const max = maxS === "" ? undefined : Number(maxS);
            onSetValidation({ kind: "textLength", min, max });
          }}
        >
          Validate: text length…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => {
            // eslint-disable-next-line no-alert
            const expr = window.prompt(
              "Custom validation formula (e.g. =ISNUMBER($cell) — must evaluate truthy):",
              "",
            );
            if (expr == null || expr === "") return;
            onSetValidation({ kind: "formula", expression: expr });
          }}
        >
          Validate: custom formula…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={() => onSetValidation(null)}
        >
          Clear validation
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!hasSelection}
          onClick={onRemoveDuplicates}
        >
          Remove duplicates in selection
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onToggleProtect}>
          {sheetIsProtected ? (
            <>
              <Unlock className="size-4" /> Unprotect sheet
            </>
          ) : (
            <>
              <Lock className="size-4" /> Protect sheet
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Insert-chart split button — chart type chosen from a dropdown. */
function InsertChartButton({
  disabled,
  onInsert,
  onInsertSparkline,
}: {
  disabled: boolean;
  onInsert: (type: ChartType) => void;
  onInsertSparkline: (kind: "line" | "column" | "bar" | "winloss") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            title="Insert chart / sparkline from selection"
            className="h-7 px-2 text-sm"
          >
            <BarChart3 className="size-4" /> Chart
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Chart</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem onClick={() => onInsert("column")}>
          Column
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onInsert("bar")}>
          Bar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onInsert("line")}>
          Line
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onInsert("area")}>
          Area
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onInsert("pie")}>
          Pie
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onInsert("scatter")}>
          Scatter
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sparkline (in cell next to selection)</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem onClick={() => onInsertSparkline("line")}>
          Sparkline — line
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onInsertSparkline("column")}>
          Sparkline — column
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onInsertSparkline("bar")}>
          Sparkline — bar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onInsertSparkline("winloss")}>
          Sparkline — win/loss
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Named-range popover. Lightweight — toggle state opens an absolute panel
 * anchored under the trigger button. Uses Base UI's DropdownMenu wrappers
 * since they already handle outside-click + escape dismissal correctly.
 */
function NamedRangesPopover({
  ranges,
  hasSelection,
  selectionDisplay,
  onAdd,
  onDelete,
}: {
  ranges: NamedRangeRow[];
  hasSelection: boolean;
  selectionDisplay: string;
  onAdd: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  // Popover (not DropdownMenu) — the panel contains a text `<input>` and
  // Base UI's Menu primitive traps Tab/arrow keys for menu-item navigation,
  // which prevents typing. Popover has no such trap.
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title="Named ranges"
            className="h-7 px-2 text-sm"
          >
            <span className="font-mono">fx</span> Names
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80 p-0">
        <SheetNamedRangesPanel
          ranges={ranges}
          hasSelection={hasSelection}
          selectionDisplay={selectionDisplay}
          onAdd={onAdd}
          onDelete={onDelete}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Row counterpart to `InsertColumnSplitButton`. */
function InsertRowSplitButton({
  selectedRowIndex,
  totalRows,
  onInsert,
}: {
  selectedRowIndex: number;
  totalRows: number;
  onInsert: (index: number) => void;
}) {
  const belowIndex = selectedRowIndex < 0 ? totalRows : selectedRowIndex + 1;
  const aboveIndex = selectedRowIndex < 0 ? totalRows : selectedRowIndex;
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-md">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => onInsert(belowIndex)}
        title={
          selectedRowIndex < 0
            ? "Append row at the end"
            : "Insert row below selection"
        }
        className="h-7 gap-1 rounded-r-none pr-1.5"
      >
        <Plus className="size-4" /> Row
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Row insertion options"
              className="h-7 w-5 rounded-l-none border-l border-border px-0"
            />
          }
        >
          <ChevronDown className="size-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto overflow-x-visible">
          <DropdownMenuItem onClick={() => onInsert(aboveIndex)}>
            Insert row above
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert(belowIndex)}>
            Insert row below
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
