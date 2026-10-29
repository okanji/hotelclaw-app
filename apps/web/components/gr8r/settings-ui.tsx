"use client";

import type { ReactNode } from "react";

/**
 * gr8r-studio's settings atoms (src/pages/settings.js): `srow` (title +
 * description left, control right), `tog` (the `.toggle` checkbox), `sel`
 * (an auto-width `.select`) and the `.seg` segmented control, plus the
 * `<h1>` + `p.lead` header every section opens with.
 */

export function SetHead({ title, lead }: { title: string; lead: ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
    </>
  );
}

export function Srow({
  t,
  d,
  children,
}: {
  t: ReactNode;
  d?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="srow">
      <div>
        <div className="t">{t}</div>
        {d ? <div className="d">{d}</div> : null}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

export function SBlock({
  title,
  danger,
  first,
  children,
}: {
  title?: ReactNode;
  danger?: boolean;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="sblock" style={first ? { marginTop: 0 } : undefined}>
      {title ? (
        <h2 style={danger ? { color: "var(--g8-red)" } : undefined}>{title}</h2>
      ) : null}
      {children}
    </div>
  );
}

export function Tog({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      className="toggle"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function Sel<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <select
      className="select"
      style={{ width: "auto", minWidth: 180 }}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map(([v, n]) => (
        <option key={v} value={v}>
          {n}
        </option>
      ))}
    </select>
  );
}

export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, n]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={value === v ? "on" : undefined}
          onClick={() => onChange(v)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** gr8r's `.faint` empty line inside a block. */
export function Faint({ children }: { children: ReactNode }) {
  return (
    <p className="faint" style={{ padding: "12px 0", margin: 0 }}>
      {children}
    </p>
  );
}
