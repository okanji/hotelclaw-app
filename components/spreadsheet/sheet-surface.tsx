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
import { ChevronDown, Plus, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  useAutoFill,
  useClearCells,
  useDeleteColumn,
  useDeleteRow,
  useInsertColumn,
  useInsertRow,
  useMoveColumn,
  useMoveRow,
  usePasteRange,
  useResizeColumn,
  useResizeRow,
  useSetCellFormat,
  useSetCellValue,
  useSortColumn,
} from "@/lib/spreadsheet/mutations";
import type {
  CellFormat,
  SheetCellAddress,
} from "@/liveblocks.config";
import { SheetCell, type CellOther } from "./sheet-cell";
import { SheetFindReplace, type FindMatch } from "./sheet-find-replace";
import {
  SheetFormatToolbar,
  type FormatPatch,
} from "./sheet-format-toolbar";
import { SheetFormulaBar, cellLabelFor } from "./sheet-formula-bar";
import { ColumnHandle, HeadersDnd, RowHandle } from "./sheet-headers";
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
  const columns = useStorage((root) => root.spreadsheet?.columns ?? []);
  const rows = useStorage((root) => root.spreadsheet?.rows ?? []);
  const cells = useStorage((root) => root.spreadsheet?.cells) as
    | CellMatrix
    | undefined;
  const history = useHistory();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const insertColumn = useInsertColumn();
  const insertRow = useInsertRow();
  const deleteColumn = useDeleteColumn();
  const deleteRow = useDeleteRow();
  const moveColumn = useMoveColumn();
  const moveRow = useMoveRow();
  const resizeColumn = useResizeColumn();
  const resizeRow = useResizeRow();
  const setCellValue = useSetCellValue();
  const setCellFormat = useSetCellFormat();
  const sortColumn = useSortColumn();
  const autoFill = useAutoFill();
  const clearCells = useClearCells();
  const pasteRange = usePasteRange();

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [edition, setEdition] = useState<EditionState>(null);
  const draggingRef = useRef<"select" | null>(null);
  const [autoFillState, setAutoFillState] = useState<AutoFillState>(null);
  const fillingRef = useRef(false);

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

  // Mirror selection into presence so collaborators see our cursor.
  const [, updatePresence] = useMyPresence();
  useEffect(() => {
    updatePresence({
      selectedCell: selection
        ? encodeCellId(selection.start.columnId, selection.start.rowId)
        : null,
      selectionRange: selection,
    });
  }, [selection, updatePresence]);

  // ── Cell graph evaluation ─────────────────────────────────────────────────
  const colIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const shape: GridShape = useMemo(
    () => ({ columnIds: colIds, rowIds }),
    [colIds, rowIds],
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

  // ── Other users' selections ───────────────────────────────────────────────
  const self = useSelf();
  const others = useOthers();
  const othersByCell = useMemo(() => {
    const map = new Map<string, CellOther>();
    for (const other of others) {
      if (!other.presence?.selectedCell) continue;
      const color = colorFor(other.connectionId);
      map.set(other.presence.selectedCell, {
        color,
        name: other.info?.name ?? "Anonymous",
      });
    }
    return map;
  }, [others]);
  const myColor = self ? colorFor(self.connectionId) : "hsl(220 90% 56%)";

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

  const setSingle = useCallback((columnId: string, rowId: string) => {
    setSelection({
      start: { columnId, rowId },
      end: { columnId, rowId },
    });
  }, []);

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
      draggingRef.current = null;
      fillingRef.current = false;
      setAutoFillState(null);
    }
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, [autoFillState, autoFill, colIds, rowIds, colIndex, rowIndex]);

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
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/60 px-4 py-1.5">
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
            className={cn("h-7 px-2 text-[12.5px]")}
            disabled={zoom <= ZOOM_MIN + 0.001}
          >
            −
          </Button>
          <button
            type="button"
            onClick={zoomReset}
            title="Reset zoom (Cmd+0)"
            className="w-12 select-none rounded px-1 text-center text-[12.5px] tabular-nums text-muted-foreground hover:bg-muted"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={zoomIn}
            title="Zoom in (Cmd+=)"
            className={cn("h-7 px-2 text-[12.5px]")}
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
                  style={tableStyle(columns)}
                >
                  <colgroup>
                    <col style={{ width: ROW_HEADER_WIDTH }} />
                    {columns.map((c) => (
                      <col key={c.id} style={{ width: c.width }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr style={{ height: COLUMN_HEADER_HEIGHT }}>
                      <th className="hc-sheet-corner" />
                      {columns.map((col, i) => (
                        <th key={col.id} className="hc-sheet-col-header">
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
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, y) => (
                      <tr key={row.id} style={{ height: row.height }}>
                        <th className="hc-sheet-row-header">
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
                          />
                        </th>
                        {columns.map((col) => {
                          const id = encodeCellId(col.id, row.id);
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
                              format={entry?.format}
                              isSelected={isSelected}
                              isInRange={isInRange}
                              isEditing={isEditing}
                              isMatch={matchKeys.has(id)}
                              isActiveMatch={activeMatchKey === id}
                              isFillCorner={fillCornerId === id}
                              other={!isSelected ? other : undefined}
                              editSeed={
                                isEditing
                                  ? (edition?.seed ?? undefined)
                                  : undefined
                              }
                              onMouseDown={(e) =>
                                onCellMouseDown(col.id, row.id, e)
                              }
                              onMouseEnter={(e) =>
                                onCellMouseEnter(col.id, row.id, e)
                              }
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
                    ))}
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
              </div>
            </div>
          </HeadersDnd>
        </HeadersDnd>
      </div>
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

const PALETTE = [
  "hsl(220 90% 56%)",
  "hsl(160 80% 38%)",
  "hsl(280 70% 55%)",
  "hsl(20 85% 55%)",
  "hsl(340 80% 55%)",
  "hsl(45 90% 50%)",
  "hsl(190 80% 45%)",
  "hsl(120 50% 40%)",
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
              className="h-7 w-5 rounded-l-none border-l border-border/60 px-0"
            />
          }
        >
          <ChevronDown className="size-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
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
              className="h-7 w-5 rounded-l-none border-l border-border/60 px-0"
            />
          }
        >
          <ChevronDown className="size-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
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
