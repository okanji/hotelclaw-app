"use client";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { CircleAlert, ConciergeBell, Eye, EyeOff, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Gi } from "@/components/gr8r/icon";

/**
 * gr8r-studio's `authShell()` (src/pages/auth.js): the full-screen frame
 * every signed-out / pre-workspace surface sits in — brand top-left, theme
 * toggle (plus an optional action) top-right, the centred column, and the
 * small footer. These routes render OUTSIDE the property shell, so the
 * frame carries its own `.g8` root for gr8r's classes to apply.
 */
export function AuthShell({
  children,
  topRight,
}: {
  children: React.ReactNode;
  topRight?: React.ReactNode;
}) {
  return (
    <div className="g8 min-h-0 flex-1">
      <div className="auth">
        <div className="auth-top">
          <span className="brand">
            <AuthMark size={26} />
            Hotelclaw
          </span>
          <div className="row">
            {topRight}
            <ThemeButton />
          </div>
        </div>
        <div className="auth-c">{children}</div>
        <div className="auth-foot" style={{ padding: 18, fontSize: 12 }}>
          <span className="faint">
            © {new Date().getFullYear()} Hotelclaw · Terms · Privacy
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The tinted icon plate gr8r puts above a card's title (`.ftype` with
 * `--c`): our ConciergeBell mark by default, or a state glyph (mail, key…)
 * in a status colour.
 */
export function AuthMark({
  icon = ConciergeBell,
  size = 44,
  color = "var(--g8-accent)",
  className,
}: {
  icon?: LucideIcon;
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={className ? `ftype ${className}` : "ftype"}
      style={
        {
          "--g8-c": color,
          width: size,
          height: size,
          borderRadius: Math.round(size / 4),
        } as React.CSSProperties
      }
    >
      <Gi icon={icon} size={Math.round(size * 0.45)} />
    </span>
  );
}

/** Centred plate row — gr8r wraps the plate in a centring flex div. */
export function AuthCardMark(props: React.ComponentProps<typeof AuthMark>) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <AuthMark {...props} />
    </div>
  );
}

/** gr8r's `ferr()` — the inline field error under an input. */
export function FieldErr({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <span className="err" id={id} role="alert">
      <Gi icon={CircleAlert} size={12} />
      {children}
    </span>
  );
}

/** gr8r's form-level `.alert.danger`. */
export function AuthAlert({
  children,
  tone = "danger",
  icon = CircleAlert,
}: {
  children: React.ReactNode;
  tone?: "danger" | "info" | "ok" | "warn";
  icon?: LucideIcon;
}) {
  return (
    <div className={`alert ${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <Gi icon={icon} size={15} />
      <span>{children}</span>
    </div>
  );
}

/**
 * gr8r's top-right theme toggle. Both glyphs render and CSS picks one (the
 * `dark:` variant keys on the same `.dark` class next-themes sets), so the
 * server render never disagrees with the client.
 */
function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      className="ibtn"
      aria-label="Toggle theme"
      title="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Gi icon={Sun} size={16} className="hidden dark:block" />
      <Gi icon={Moon} size={16} className="dark:hidden" />
    </button>
  );
}

/**
 * gr8r's password field: `.inwrap` with a show / hide `ibtn` on the right.
 * Every other input prop passes straight through.
 */
export function PasswordInput({
  className,
  style,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="inwrap">
      <input
        {...props}
        type={show ? "text" : "password"}
        className={className ? `input input-lg ${className}` : "input input-lg"}
        style={{ paddingLeft: 10, paddingRight: 38, ...style }}
      />
      <button
        type="button"
        className="ibtn ibtn-sm"
        style={{ position: "absolute", right: 5 }}
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
      >
        <Gi icon={show ? EyeOff : Eye} size={15} />
      </button>
    </div>
  );
}

/** gr8r's `strengthMeter()` (settings.js): four bars + a word. */
export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  let s = 0;
  if (password.length >= 8) s++;
  if (password.length >= 12) s++;
  if (/[0-9]/.test(password) && /[a-zA-Z]/.test(password)) s++;
  if (/[^a-zA-Z0-9]/.test(password)) s++;
  const c = [
    "var(--g8-red)",
    "var(--g8-red)",
    "var(--g8-amber)",
    "var(--g8-green)",
    "var(--g8-green)",
  ][s];
  const n = ["Too short", "Weak", "Fair", "Good", "Strong"][s];
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="strength grow" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i
            key={i}
            className={i < s ? "on" : undefined}
            style={{ "--g8-c": c } as React.CSSProperties}
          />
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: c, width: 60, textAlign: "right" }}>
        {n}
      </span>
    </div>
  );
}
