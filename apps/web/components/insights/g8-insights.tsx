"use client";

import type { CSSProperties, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";

/**
 * gr8r-studio vocabulary for the Insights surface (and the planning pages
 * that borrow it). gr8r has no analytics page, so these compose its
 * dashboard primitives: `.panel` / `.panel-h` / `.panel-b` sections, the
 * `.stats` / `.stat` strip, `.mini` hairline rows, `.empty-state`. The
 * `ins-*` helpers are ours — see the Insights block in app/gr8r-ext.css.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export type G8Stat = {
  k: ReactNode;
  v: ReactNode;
  /** One quiet line under the value. */
  d?: ReactNode;
  /** `.d.up` (green) / `.d.bad` (red). */
  tone?: "up" | "bad";
  /** A `.badge` beside the label ("Review", "Assign"). */
  flag?: ReactNode;
};

/** gr8r `.stats` — the bordered stat strip (auto-fits its columns). */
export function G8Stats({ items }: { items: G8Stat[] }) {
  return (
    <div className="stats ins-stats">
      {items.map((s, i) => (
        <div key={i} className="stat">
          <span className="k">
            {s.k}
            {s.flag ? <span className="ins-flag">{s.flag}</span> : null}
          </span>
          <span className="v">{s.v}</span>
          {s.d ? <span className={s.tone ? `d ${s.tone}` : "d"}>{s.d}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Compact inline stats ("12 meetings · 4 hours …") for panel internals. */
export function G8InlineStats({
  items,
}: {
  items: { label: string; value: number | string; tone?: "rose" | "emerald" }[];
}) {
  return (
    <dl className="ins-istats">
      {items.map((s) => (
        <div key={s.label}>
          <dd className={s.tone === "rose" && Number(s.value) > 0 ? "bad" : undefined}>
            {s.value}
          </dd>
          <dt>{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** A quiet sentence where a panel has nothing to show. */
export function G8Note({ children }: { children: ReactNode }) {
  return <p className="ins-note">{children}</p>;
}

/** Bleeds `.mini` rows to the panel edge (gr8r's dashboard row list). */
export function G8Rows({ children }: { children: ReactNode }) {
  return <div className="ins-rows">{children}</div>;
}

/** Chart legend row: a short swatch (`line` = 2px stroke) + label. */
export function G8Legend({
  items,
}: {
  items: { label: string; color: string; line?: boolean }[];
}) {
  return (
    <div className="ins-legend">
      {items.map((it) => (
        <span key={it.label}>
          <i
            className={it.line ? "ln" : undefined}
            style={{ "--g8-c": it.color } as CSSVars}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function SectionHead({
  kicker,
  title,
  grip,
  right,
}: {
  kicker?: string;
  title: string;
  grip?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="panel-h">
      {grip}
      <div className="ins-ttl">
        {kicker ? <span className="eyebrow">{kicker}</span> : null}
        <h2>{title}</h2>
      </div>
      {right ? <div className="acts">{right}</div> : null}
    </div>
  );
}

/** A static gr8r `.panel` section. `wide` spans both grid columns. */
export function G8Section({
  kicker,
  title,
  headerRight,
  wide = false,
  children,
}: {
  kicker?: string;
  title: string;
  headerRight?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={wide ? "panel ins-sec wide" : "panel ins-sec"}>
      <SectionHead kicker={kicker} title={title} right={headerRight} />
      <div className="panel-b">{children}</div>
    </section>
  );
}

/** The dnd-kit sortable `.panel` — grip + hide reveal on hover. */
export function G8SortableSection({
  id,
  kicker,
  title,
  onHide,
  headerRight,
  wide = false,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  onHide: () => void;
  headerRight?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={[
        "panel ins-sec",
        wide ? "wide" : "",
        isDragging ? "dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <SectionHead
        kicker={kicker}
        title={title}
        grip={
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Drag ${title}`}
            className="ibtn ibtn-xs ins-grip"
            {...attributes}
            {...listeners}
          >
            <Gi icon={GripVertical} size={13} />
          </button>
        }
        right={
          <>
            {headerRight}
            <button
              type="button"
              className="ibtn ibtn-sm ins-hide"
              aria-label={`Hide ${title}`}
              title="Hide"
              onClick={onHide}
            >
              <Gi icon={EyeOff} size={13} />
            </button>
          </>
        }
      />
      <div className="panel-b">{children}</div>
    </section>
  );
}

/** Hidden sections as gr8r chips that bring each one back. */
export function G8HiddenTray({
  items,
  hidden,
  onRestore,
}: {
  items: { id: string; title: string }[];
  hidden: string[];
  onRestore: (id: string) => void;
}) {
  if (hidden.length === 0) return null;
  return (
    <div className="ins-tray">
      <span className="eyebrow">Hidden</span>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {hidden.map((id) => {
          const def = items.find((w) => w.id === id);
          if (!def) return null;
          return (
            <button
              key={id}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onRestore(id)}
              title={`Show ${def.title}`}
            >
              <Gi icon={Eye} size={13} />
              {def.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
