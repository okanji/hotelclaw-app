"use client";

import { isValidElement, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, CloudAlert, RefreshCw } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { AuthShell } from "@/components/auth/auth-shell";

/**
 * gr8r's full-pane states (src/pages/errors.js — `page404`, `stateDenied`,
 * `stateFailed`): `.fullstate` › `.box` with the empty-state glyph, an
 * optional mono `ERROR 404` code, the title, one line of copy and a button
 * row. Renders INSIDE whatever `.g8` root it lands in — the property shell,
 * or the AuthShell frame for routes outside it.
 */
export function FullState({
  icon,
  code,
  title,
  message,
  failed = false,
  digest,
  children,
}: {
  /** A Lucide component — or, from a SERVER page, a rendered element
   *  (`<Gi icon={…} size={20} />`): components can't cross into this
   *  client component as props. */
  icon: LucideIcon | React.ReactElement;
  code?: string;
  title: string;
  message: React.ReactNode;
  /** gr8r's `.empty-state.err` — the glyph turns red. */
  failed?: boolean;
  digest?: string;
  /** The `.row` of buttons. */
  children?: React.ReactNode;
}) {
  return (
    <div className="fullstate">
      <div className="box" role={failed ? "alert" : undefined}>
        <div
          className={failed ? "empty-state err" : "empty-state"}
          style={{ padding: 0 }}
        >
          <div className="glyph">
            {isValidElement(icon) ? icon : <Gi icon={icon as LucideIcon} size={20} />}
          </div>
        </div>
        {code ? <span className="code">{code}</span> : null}
        <h1>{title}</h1>
        <p>{message}</p>
        {children ? <div className="row">{children}</div> : null}
        {digest ? <span className="code">Ref: {digest}</span> : null}
      </div>
    </div>
  );
}

/** gr8r's "Go back" secondary button (`data-a="back"`). */
export function GoBackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => router.back()}
    >
      <Gi icon={ArrowLeft} size={14} />
      Go back
    </button>
  );
}

/** gr8r's `stateFailed` "Try again" primary button. */
export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-primary" onClick={onClick}>
      <Gi icon={RefreshCw} size={14} />
      Try again
    </button>
  );
}

/**
 * Error pane for the narrow routes outside the property shell (login,
 * forgot / update password, invites, welcome, onboarding): gr8r's
 * `stateFailed` inside the auth frame, so a failed segment still carries
 * the brand + theme toggle rather than a bare page.
 */
export function RouteError({
  error,
  reset,
  title = "Something went wrong",
  message = "This page failed to load. Try again in a moment.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  message?: string;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <AuthShell>
      <FullState
        icon={CloudAlert}
        title={title}
        message={message}
        failed
        digest={error.digest}
      >
        <RetryButton onClick={reset} />
      </FullState>
    </AuthShell>
  );
}
