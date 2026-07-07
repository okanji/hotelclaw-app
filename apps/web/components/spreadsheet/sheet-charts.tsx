"use client";

/**
 * Charts layer. Reads `workbook.charts` and renders each chart anchored to
 * its sheet as a floating overlay. Recharts handles the actual rendering;
 * we own positioning, drag-to-move, drag-to-resize, and the popup chrome.
 *
 * Range → chart data pipeline:
 *   1. Caller (surface) hands us the `cellValues` map for the chart's sheet.
 *   2. We expand the chart's `startRef:endRef` range into a 2D matrix.
 *   3. With `firstRowIsHeader`, row 0 becomes axis labels; otherwise the
 *      header is auto-generated (A/B/C...).
 *   4. Each column becomes a series; each row is a data point.
 *
 * Recharts treats `data` as an array of objects keyed by series name. We
 * shape the matrix into that shape per chart type.
 */

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as RechartsCell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChartType } from "@/liveblocks.config";

const COLORS = [
  "hsl(220 90% 56%)",
  "hsl(160 80% 38%)",
  "hsl(280 70% 55%)",
  "hsl(20 85% 55%)",
  "hsl(340 80% 55%)",
  "hsl(45 90% 50%)",
  "hsl(190 80% 45%)",
  "hsl(120 50% 40%)",
];

export type ChartSpec = {
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
  firstRowIsHeader?: boolean;
  firstColumnIsHeader?: boolean;
};

/**
 * Layer component — rendered absolutely above the grid's scroll area.
 * The surface positions it so coordinates are relative to the grid's
 * top-left data cell (excluding the row-header gutter).
 */
export function SheetChartsLayer({
  charts,
  activeSheetId,
  cellValues,
  columnIds,
  rowIds,
  onUpdate,
  onDelete,
}: {
  charts: ReadonlyArray<ChartSpec>;
  activeSheetId: string;
  cellValues: Map<string, string>;
  columnIds: ReadonlyArray<string>;
  rowIds: ReadonlyArray<string>;
  onUpdate: (chartId: string, patch: Partial<ChartSpec>) => void;
  onDelete: (chartId: string) => void;
}) {
  return (
    <>
      {charts
        .filter((c) => c.sheetId === activeSheetId)
        .map((chart) => (
          <FloatingChart
            key={chart.id}
            chart={chart}
            cellValues={cellValues}
            columnIds={columnIds}
            rowIds={rowIds}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}

function FloatingChart({
  chart,
  cellValues,
  columnIds,
  rowIds,
  onUpdate,
  onDelete,
}: {
  chart: ChartSpec;
  cellValues: Map<string, string>;
  columnIds: ReadonlyArray<string>;
  rowIds: ReadonlyArray<string>;
  onUpdate: (chartId: string, patch: Partial<ChartSpec>) => void;
  onDelete: (chartId: string) => void;
}) {
  const data = useMemo(
    () =>
      chartDataFromRange(
        chart,
        cellValues,
        columnIds as string[],
        rowIds as string[],
      ),
    [chart, cellValues, columnIds, rowIds],
  );
  const [editing, setEditing] = useState(false);

  return (
    <div
      className="hc-sheet-chart"
      style={{
        position: "absolute",
        left: chart.x,
        top: chart.y,
        width: chart.width,
        height: chart.height,
      }}
    >
      <div
        className="hc-sheet-chart-chrome"
        onMouseDown={(e) => beginDrag(e, chart, "move", onUpdate)}
      >
        <GripVertical className="size-3 opacity-50" />
        {editing ? (
          <input
            type="text"
            defaultValue={chart.title}
            onBlur={(e) => {
              onUpdate(chart.id, { title: e.target.value });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdate(chart.id, {
                  title: (e.target as HTMLInputElement).value,
                });
                setEditing(false);
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder={chartTypeLabel(chart.type)}
            className="flex-1 min-w-0 bg-transparent text-xs font-medium outline-none"
            autoFocus
          />
        ) : (
          <span
            className="flex-1 truncate text-xs font-medium"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {chart.title || chartTypeLabel(chart.type)}
          </span>
        )}
        <select
          value={chart.type}
          onChange={(e) =>
            onUpdate(chart.id, { type: e.target.value as ChartType })
          }
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded border border-border/60 bg-background px-1 py-0.5 text-xs"
          title="Chart type"
        >
          <option value="column">Column</option>
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="area">Area</option>
          <option value="pie">Pie</option>
          <option value="scatter">Scatter</option>
        </select>
        <label
          className="flex items-center gap-1 text-xs text-muted-foreground"
          title="First row of source range is treated as headers"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={chart.firstRowIsHeader !== false}
            onChange={(e) =>
              onUpdate(chart.id, { firstRowIsHeader: e.target.checked })
            }
          />
          Header
        </label>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-5"
          title="Delete chart"
          onClick={() => onDelete(chart.id)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X className="size-3" />
        </Button>
      </div>
      <div className="hc-sheet-chart-body">
        <ChartByType chart={chart} data={data} />
      </div>
      <div
        className="hc-sheet-chart-resize"
        onMouseDown={(e) => beginDrag(e, chart, "resize", onUpdate)}
      />
    </div>
  );
}

function ChartByType({ chart, data }: { chart: ChartSpec; data: ChartData }) {
  if (data.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Empty range
      </div>
    );
  }
  switch (chart.type) {
    case "line":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="__label" fontSize={10} stroke="var(--muted-foreground)" />
            <YAxis fontSize={10} stroke="var(--muted-foreground)" />
            <Tooltip />
            <Legend />
            {data.series.map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    case "area":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="__label" fontSize={10} stroke="var(--muted-foreground)" />
            <YAxis fontSize={10} stroke="var(--muted-foreground)" />
            <Tooltip />
            <Legend />
            {data.series.map((s, i) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.3}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    case "bar":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.rows}
            layout="vertical"
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" fontSize={10} stroke="var(--muted-foreground)" />
            <YAxis dataKey="__label" type="category" fontSize={10} stroke="var(--muted-foreground)" />
            <Tooltip />
            <Legend />
            {data.series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    case "column":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="__label" fontSize={10} stroke="var(--muted-foreground)" />
            <YAxis fontSize={10} stroke="var(--muted-foreground)" />
            <Tooltip />
            <Legend />
            {data.series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    case "pie":
      // Pie uses the FIRST series only; data points are { name, value }.
      // Picks the first numeric series.
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie
              data={data.rows.map((r) => ({
                name: r.__label,
                value: data.series[0] ? (r[data.series[0]] as number) : 0,
              }))}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="70%"
              label
            >
              {data.rows.map((_, i) => (
                <RechartsCell
                  key={i}
                  fill={COLORS[i % COLORS.length]}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      );
    case "scatter":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey={data.series[0]}
              type="number"
              fontSize={10}
              stroke="var(--muted-foreground)"
            />
            <YAxis
              dataKey={data.series[1]}
              type="number"
              fontSize={10}
              stroke="var(--muted-foreground)"
            />
            <Tooltip />
            <Scatter data={data.rows} fill={COLORS[0]!} />
          </ScatterChart>
        </ResponsiveContainer>
      );
  }
}

type ChartData = {
  series: string[];
  rows: Array<Record<string, number | string> & { __label: string }>;
};

function chartDataFromRange(
  chart: ChartSpec,
  cellValues: Map<string, string>,
  columnIds: string[],
  rowIds: string[],
): ChartData {
  // Find the corner indices.
  const split = (ref: string): { col: number; row: number } | null => {
    const at = ref.indexOf("@");
    if (at <= 0) return null;
    const col = columnIds.indexOf(ref.slice(0, at));
    const row = rowIds.indexOf(ref.slice(at + 1));
    if (col < 0 || row < 0) return null;
    return { col, row };
  };
  const tl = split(chart.startRef);
  const br = split(chart.endRef);
  if (!tl || !br) return { series: [], rows: [] };

  const minX = Math.min(tl.col, br.col);
  const maxX = Math.max(tl.col, br.col);
  const minY = Math.min(tl.row, br.row);
  const maxY = Math.max(tl.row, br.row);

  const headerRow = chart.firstRowIsHeader === false ? -1 : minY;
  const labelCol = chart.firstColumnIsHeader === false ? -1 : minX;

  // Build series names.
  const series: string[] = [];
  for (let x = minX; x <= maxX; x++) {
    if (x === labelCol) continue;
    let name = "";
    if (headerRow >= 0) {
      const c = columnIds[x];
      const r = rowIds[headerRow];
      if (c && r) name = cellValues.get(`${c}@${r}`) ?? "";
    }
    if (!name) name = `Series ${series.length + 1}`;
    series.push(name);
  }

  // Build rows.
  const rows: Array<Record<string, number | string> & { __label: string }> = [];
  for (let y = minY; y <= maxY; y++) {
    if (y === headerRow) continue;
    let label = "";
    if (labelCol >= 0) {
      const c = columnIds[labelCol];
      const r = rowIds[y];
      if (c && r) label = cellValues.get(`${c}@${r}`) ?? "";
    }
    if (!label) label = `${y - (headerRow >= 0 ? minY : minY - 1)}`;
    const row: Record<string, number | string> & { __label: string } = {
      __label: label,
    };
    let seriesIdx = 0;
    for (let x = minX; x <= maxX; x++) {
      if (x === labelCol) continue;
      const c = columnIds[x];
      const r = rowIds[y];
      const raw = c && r ? cellValues.get(`${c}@${r}`) ?? "" : "";
      const n = Number(raw);
      row[series[seriesIdx]!] = Number.isFinite(n) ? n : 0;
      seriesIdx++;
    }
    rows.push(row);
  }
  return { series, rows };
}

/**
 * Mouse-driven drag (move or resize). Listens at the window level so the
 * pointer can leave the chart's bounds without dropping the drag.
 */
function beginDrag(
  e: React.MouseEvent,
  chart: ChartSpec,
  mode: "move" | "resize",
  onUpdate: (id: string, patch: Partial<ChartSpec>) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const initX = chart.x;
  const initY = chart.y;
  const initW = chart.width;
  const initH = chart.height;
  function onMove(ev: MouseEvent) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (mode === "move") {
      onUpdate(chart.id, {
        x: Math.max(0, initX + dx),
        y: Math.max(0, initY + dy),
      });
    } else {
      onUpdate(chart.id, {
        width: Math.max(160, initW + dx),
        height: Math.max(120, initH + dy),
      });
    }
  }
  function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function chartTypeLabel(t: ChartType): string {
  switch (t) {
    case "line":
      return "Line chart";
    case "bar":
      return "Bar chart";
    case "column":
      return "Column chart";
    case "area":
      return "Area chart";
    case "pie":
      return "Pie chart";
    case "scatter":
      return "Scatter chart";
  }
}
