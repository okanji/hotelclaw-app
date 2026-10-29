"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { AuthCardMark, AuthShell, FieldErr } from "@/components/auth/auth-shell";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // `?next=` must be present: the custom recovery email template appends
    // `&token_hash=…` to this URL. (type=recovery routes to /update-password
    // in /auth/confirm regardless.)
    const redirectTo = `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/update-password")}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setSent(true);
    setBusy(false);
  }

  const backToSignIn = (
    <p className="auth-foot">
      <Link
        href="/login"
        className="link"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Gi icon={ArrowLeft} size={14} />
        Back to sign in
      </Link>
    </p>
  );

  if (sent) {
    // gr8r's "forgot-sent" card.
    return (
      <AuthShell>
        <div className="auth-card fx-auth">
          <AuthCardMark icon={MailCheck} color="var(--g8-green)" />
          <h1>Check your inbox</h1>
          <p className="sub">
            If an account exists for{" "}
            <b style={{ color: "var(--g8-text)" }}>{email}</b>, we sent a
            password-reset link.
          </p>
          <p className="auth-foot">
            Didn&apos;t get it?{" "}
            <button
              type="button"
              className="link"
              onClick={() => setSent(false)}
            >
              Try again
            </button>
          </p>
          {backToSignIn}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className="auth-card fx-auth" onSubmit={onSubmit}>
        <AuthCardMark icon={KeyRound} />
        <h1>Reset your password</h1>
        <p className="sub">
          Enter your account email and we&apos;ll send you a reset link.
        </p>
        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@hotel.com"
            className={`input input-lg${error ? " is-error" : ""}`}
            aria-invalid={error ? true : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          {error ? <FieldErr>{error}</FieldErr> : null}
        </div>
        <button
          type="submit"
          className={`btn btn-primary btn-lg btn-block${busy ? " is-loading" : ""}`}
          disabled={busy}
        >
          Send reset link
        </button>
        {backToSignIn}
      </form>
    </AuthShell>
  );
}
