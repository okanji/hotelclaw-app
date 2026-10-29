import type { CSSProperties, ReactNode } from "react";

/**
 * gr8r-studio's loading skeletons (src/shell/skeletons.js — `sk`, `skRows`,
 * `skCards`, `skBoard`, `skeleton()`) as server-safe React, for the route
 * `loading.tsx` files. Everything is gr8r's `.sk` shimmer inside the page
 * chrome the real page uses (`.page` / `.ph` / `.panel` / `.pgrid` /
 * `.board`), so arrival doesn't jump. No hooks, no client code.
 */

/** One shimmer bar — gr8r `sk(w, h, extra)`. */
export function Sk({
  w,
  h = 10,
  r,
  style,
}: {
  w: number | string;
  h?: number;
  r?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="sk"
      style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }}
    />
  );
}

/** gr8r `skRows(n)` — list rows: glyph, title, status pill, avatar, date. */
export function SkRows({ n = 8, pad = 8 }: { n?: number; pad?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="row"
          style={{
            height: 40,
            borderBottom: "1px solid var(--g8-divider)",
            gap: 12,
            padding: `0 ${pad}px`,
          }}
        >
          <Sk w={15} h={15} r={4} />
          <Sk w={`${38 + ((i * 13) % 30)}%`} />
          <span className="sp" />
          <Sk w={70} h={18} r={5} />
          <Sk w={22} h={22} r="50%" />
          <Sk w={54} />
        </div>
      ))}
    </>
  );
}

/** Compact `.mini`-height rows for inside a `.panel`. */
export function SkMini({ n = 5 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="row"
          style={{ minHeight: 38, gap: 10, padding: "0 14px", borderTop: i ? "1px solid var(--g8-divider)" : 0 }}
        >
          <Sk w={14} h={14} r={4} />
          <Sk w={`${42 + ((i * 17) % 34)}%`} />
          <span className="sp" />
          <Sk w={40} />
        </div>
      ))}
    </>
  );
}

/** gr8r `skCards(n)` — the `.pgrid` card grid. */
export function SkCards({ n = 6 }: { n?: number }) {
  return (
    <div className="pgrid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="pcard" style={{ cursor: "default" }}>
          <Sk w={28} h={28} r={7} />
          <Sk w="60%" h={12} />
          <Sk w="90%" h={9} />
          <Sk w="70%" h={9} />
          <Sk w="100%" h={4} />
        </div>
      ))}
    </div>
  );
}

/** gr8r `skBoard()` — kanban columns of cards. */
export function SkBoard() {
  return (
    <div className="board">
      {[3, 4, 3, 2].map((n, c) => (
        <div key={c} className="bcol">
          <div className="bcol-h">
            <Sk w={80} h={11} />
          </div>
          <div className="bcol-b">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="kcard" style={{ cursor: "default" }}>
                <Sk w="40%" h={14} r={5} />
                <Sk w={`${(60 + i * 9) % 95}%`} />
                <div className="row" style={{ gap: 6 }}>
                  <Sk w={40} h={9} />
                  <Sk w={30} h={9} />
                  <span className="sp" />
                  <Sk w={18} h={18} r="50%" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The `.ph` header: title + lede bars, optional action pills on the right. */
export function SkHead({
  title = 220,
  lede = 320,
  acts = 0,
  icon,
}: {
  title?: number;
  lede?: number | null;
  acts?: number;
  icon?: boolean;
}) {
  return (
    <div className="ph">
      {icon ? <Sk w={36} h={36} r={9} /> : null}
      <div className="col" style={{ gap: 8 }}>
        <Sk w={title} h={20} />
        {lede ? <Sk w={lede} h={11} /> : null}
      </div>
      {acts ? (
        <div className="acts">
          {Array.from({ length: acts }, (_, i) => (
            <Sk key={i} w={i === acts - 1 ? 96 : 72} h={28} r={7} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A `.panel` with a header bar and `n` mini rows. */
export function SkPanel({ n = 5, title = 110 }: { n?: number; title?: number }) {
  return (
    <section className="panel">
      <div className="panel-h">
        <Sk w={title} h={12} />
      </div>
      <SkMini n={n} />
    </section>
  );
}

/** gr8r `.tabs` strip placeholder. */
export function SkTabs({ n = 4 }: { n?: number }) {
  return (
    <div className="tabs" style={{ marginBottom: 16, gap: 18, padding: "0 4px", alignItems: "center", height: 36 }}>
      {Array.from({ length: n }, (_, i) => (
        <Sk key={i} w={52 + ((i * 11) % 24)} h={10} />
      ))}
    </div>
  );
}

/** The page's `.topbar` (PageHeader) — crumb bars only, no live controls. */
export function SkTopbar({ crumbs = [140] }: { crumbs?: number[] }) {
  return (
    <header className="topbar" aria-hidden="true">
      <div className="row" style={{ gap: 8 }}>
        {crumbs.map((w, i) => (
          <Sk key={i} w={w} h={12} />
        ))}
      </div>
    </header>
  );
}

/** Topbar + the `.page` frame the real pages render in, marked busy for AT. */
export function SkPage({
  children,
  variant,
  style,
  crumbs,
}: {
  children: ReactNode;
  variant?: "wide" | "flush";
  style?: CSSProperties;
  /** Topbar crumb widths; `null` drops the topbar. */
  crumbs?: number[] | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {crumbs === null ? null : <SkTopbar crumbs={crumbs} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={variant ? `page ${variant}` : "page"}
          style={style}
          aria-busy="true"
          aria-label="Loading"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
