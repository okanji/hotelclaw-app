"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Task } from "@/components/tasks/kanban";
import { rescheduleTask } from "@/components/tasks/actions";
import { isDone } from "@/lib/tasks/statuses";
import { Gi } from "./icon";
import { Av, PrIcon, StIcon } from "./home-glyphs";
import type { CSSVars } from "./project-page";

/**
 * The project's Calendar tab — gr8r's `calendarHtml` month view
 * (src/views/calendar.js): `.cal` › `.toolbar` (Today, ‹ ›, month label) ›
 * `.cal-h` weekday row › `.cal-g` of `.cday` cells with `.cev` task chips
 * on their due day. Chips drag to another day (moves `due_at`, keeping the
 * time of day — the same `rescheduleTask` action as the Gantt) and open
 * the task; "+" on a day creates a task in this project.
 */

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function ProjectCalendar({
  propertyId,
  projectId,
  tasks,
  color,
  people,
}: {
  propertyId: string;
  projectId: string;
  tasks: Task[];
  /** The project's gr8r colour — every chip carries it (`--g8-c`). */
  color: string;
  people: Map<string, { id: string; name: string | null; avatarUrl: string | null }>;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [overDay, setOverDay] = useState<string | null>(null);
  const todayKey = dayKey(new Date());

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_at) continue;
      const k = dayKey(new Date(t.due_at));
      const list = m.get(k) ?? [];
      list.push(t);
      m.set(k, list);
    }
    return m;
  }, [tasks]);

  const cells = useMemo(() => {
    const start = addDays(cursor, -cursor.getDay());
    const all = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return all[35]!.getMonth() !== cursor.getMonth() ? all.slice(0, 35) : all;
  }, [cursor]);

  const label = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  async function moveTo(taskId: string, key: string) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t?.due_at) return;
    const prev = new Date(t.due_at);
    const [y, m, d] = key.split("-").map(Number);
    const next = new Date(prev);
    next.setFullYear(y!, (m ?? 1) - 1, d ?? 1);
    if (next.getTime() === prev.getTime()) return;
    const res = await rescheduleTask({ taskId, dueAt: next.toISOString() });
    if ("error" in res) toast.error(res.error);
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }

  return (
    <div className="cal" style={{ minHeight: 640 }}>
      <div className="toolbar" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const d = new Date();
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
          }}
        >
          Today
        </button>
        <div className="row" style={{ gap: 0 }}>
          <button
            type="button"
            className="ibtn ibtn-sm"
            aria-label="Previous month"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          >
            <Gi icon={ChevronLeft} size={16} />
          </button>
          <button
            type="button"
            className="ibtn ibtn-sm"
            aria-label="Next month"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          >
            <Gi icon={ChevronRight} size={16} />
          </button>
        </div>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 4px", letterSpacing: "-.01em" }} aria-live="polite">
          {label}
        </h2>
        <span className="sp" />
        <span className="faint" style={{ fontSize: 12 }}>
          Tasks by due date
        </span>
      </div>
      <div className="cal-h">
        {WD.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="cal-g" style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(112px, 1fr))` }}>
        {cells.map((d) => {
          const k = dayKey(d);
          const items = byDay.get(k) ?? [];
          const isToday = k === todayKey;
          const cls = ["cday", d.getMonth() !== cursor.getMonth() ? "out" : "", isToday ? "today" : "", overDay === k ? "over" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={k}
              className={cls}
              style={{ position: "relative" }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("text/x-g8-task")) return;
                e.preventDefault();
                setOverDay(k);
              }}
              onDragLeave={() => setOverDay((o) => (o === k ? null : o))}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/x-g8-task");
                setOverDay(null);
                if (id) void moveTo(id, k);
              }}
            >
              <span className="dn" aria-current={isToday ? "date" : undefined}>
                {d.getDate()}
              </span>
              <button
                type="button"
                className="ibtn ibtn-xs add"
                aria-label={`Add task on ${d.toLocaleDateString()}`}
                onClick={() => router.push(`/p/${propertyId}/tasks/new?project=${projectId}`)}
              >
                <Gi icon={Plus} size={13} />
              </button>
              {items.slice(0, 3).map((t) => {
                const done = isDone(t);
                const who = t.assignee_id ? people.get(t.assignee_id) : undefined;
                return (
                  <Link
                    key={t.id}
                    href={`/p/${propertyId}/tasks/${t.id}`}
                    className={done ? "cev done" : "cev"}
                    style={{ "--g8-c": color } as CSSVars}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/x-g8-task", t.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    title={t.title}
                  >
                    {done ? <StIcon task={t} size={11} /> : <PrIcon priority={t.priority} size={11} />}
                    <span className="trunc">{t.title || "Untitled task"}</span>
                    {who ? <Av member={who} size="" /> : null}
                  </Link>
                );
              })}
              {items.length > 3 ? (
                <span className="cmore" title={items.slice(3).map((t) => t.title).join("\n")}>
                  +{items.length - 3} more
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
