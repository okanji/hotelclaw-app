"use client";

/**
 * `chart` — inline editable chart block. Stores a small data table in node
 * attrs and renders it with recharts as a bar / line / pie / area chart.
 *
 * Data model:
 *   data.headers  — column names. First column is the X-axis category;
 *                   remaining columns are independent data series.
 *   data.rows     — string[][]; row[0] is the category label, row[1..] are
 *                   the numeric series values (parsed at render).
 *
 * Stored as strings so the editor doesn't lose blank cells while typing,
 * and so we don't conflate `null`/`undefined`/`0` distinctions across the
 * Yjs sync boundary. The view parses + coerces to numbers on render.
 */

import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { ChartView } from "@/components/documents/nodes/chart-view";

export type ChartType = "bar" | "line" | "area" | "pie";

export type ChartData = {
  headers: string[];
  rows: string[][];
};

const DEFAULT_DATA: ChartData = {
  headers: ["Category", "Value"],
  rows: [
    ["A", "10"],
    ["B", "20"],
    ["C", "15"],
    ["D", "30"],
  ],
};

export const Chart = Node.create({
  name: "chart",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      type: { default: "bar" as ChartType },
      title: { default: "" as string },
      data: { default: DEFAULT_DATA as ChartData },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-type='chart']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "chart" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartView);
  },
});
