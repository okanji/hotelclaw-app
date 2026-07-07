"use client";

import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BarChart3, LineChart as LineIcon, PieChart as PieIcon, AreaChart as AreaIcon, Pencil, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartType, ChartData } from "@/lib/documents/nodes/chart";
import { ChartDataEditor } from "./chart-data-editor";

const PIE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

const TYPE_OPTIONS: { type: ChartType; label: string; Icon: typeof BarChart3 }[] = [
  { type: "bar", label: "Bar", Icon: BarChart3 },
  { type: "line", label: "Line", Icon: LineIcon },
  { type: "area", label: "Area", Icon: AreaIcon },
  { type: "pie", label: "Pie", Icon: PieIcon },
];

/** Convert the stored data (string[][]) into recharts' row-of-objects shape. */
function toRechartsData(data: ChartData): Record<string, string | number>[] {
  return data.rows.map((row) => {
    const out: Record<string, string | number> = {};
    data.headers.forEach((h, i) => {
      if (i === 0) {
        out[h] = row[i] ?? "";
      } else {
        const n = Number(row[i] ?? "");
        out[h] = Number.isFinite(n) ? n : 0;
      }
    });
    return out;
  });
}

export function ChartView({ node, updateAttributes, editor }: NodeViewProps) {
  const type = (node.attrs.type as ChartType) ?? "bar";
  const title = (node.attrs.title as string) ?? "";
  const data = (node.attrs.data as ChartData) ?? { headers: [], rows: [] };
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(false);

  const rechartsData = toRechartsData(data);
  const xKey = data.headers[0] ?? "";
  const seriesKeys = data.headers.slice(1);

  return (
    <NodeViewWrapper data-type="chart" className="chart my-2">
      <div
        contentEditable={false}
        className="overflow-hidden rounded-lg border border-border bg-muted/20"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5">
          <input
            value={title}
            placeholder="Untitled chart"
            onChange={(e) => updateAttributes({ title: e.target.value })}
            disabled={!editable}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-default"
          />
          <div className="flex items-center gap-0.5">
            {TYPE_OPTIONS.map(({ type: t, label, Icon }) => (
              <button
                key={t}
                type="button"
                onClick={() => updateAttributes({ type: t })}
                disabled={!editable}
                title={label}
                className={cn(
                  "flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
                  type === t && "bg-muted text-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
            {editable ? (
              <button
                type="button"
                onClick={() => setEditing((s) => !s)}
                title={editing ? "View" : "Edit data"}
                className={cn(
                  "ml-1 flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
                  editing && "bg-muted text-foreground",
                )}
              >
                {editing ? (
                  <Eye className="size-3.5" />
                ) : (
                  <Pencil className="size-3.5" />
                )}
              </button>
            ) : null}
          </div>
        </div>
        <div className="bg-background p-3">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {renderChart(type, rechartsData, xKey, seriesKeys)}
            </ResponsiveContainer>
          </div>
          {editing ? (
            <div className="mt-3">
              <ChartDataEditor
                data={data}
                onChange={(next) => updateAttributes({ data: next })}
              />
            </div>
          ) : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function renderChart(
  type: ChartType,
  data: Record<string, string | number>[],
  xKey: string,
  seriesKeys: string[],
) {
  if (type === "pie") {
    // Pie expects single series — use the first series column.
    const series = seriesKeys[0];
    return (
      <PieChart>
        <Pie
          data={data}
          dataKey={series}
          nameKey={xKey}
          outerRadius={90}
          label
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    );
  }
  if (type === "line") {
    return (
      <LineChart data={data}>
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Legend />
        {seriesKeys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={PIE_COLORS[i % PIE_COLORS.length]}
            dot={false}
          />
        ))}
      </LineChart>
    );
  }
  if (type === "area") {
    return (
      <AreaChart data={data}>
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Legend />
        {seriesKeys.map((k, i) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            stroke={PIE_COLORS[i % PIE_COLORS.length]}
            fill={PIE_COLORS[i % PIE_COLORS.length]}
            fillOpacity={0.25}
          />
        ))}
      </AreaChart>
    );
  }
  // bar
  return (
    <BarChart data={data}>
      <XAxis dataKey={xKey} />
      <YAxis />
      <Tooltip />
      <Legend />
      {seriesKeys.map((k, i) => (
        <Bar key={k} dataKey={k} fill={PIE_COLORS[i % PIE_COLORS.length]} />
      ))}
    </BarChart>
  );
}
