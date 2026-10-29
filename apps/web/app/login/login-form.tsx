"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Building2, Mail, ArrowLeft } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  AuthAlert,
  AuthCardMark,
  AuthShell,
  PasswordInput,
  StrengthMeter,
} from "@/components/auth/auth-shell";

type Mode = "signin" | "signup";

type InvitePreview = {
  token: string;
  role: string;
  propertyName: string;
};

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "password">(null);
  const [error, setError] = useState<string | null>(null);
  const [signupNeedsConfirm, setSignupNeedsConfirm] = useState(false);
  // Keyed by the email it was fetched for, so a stale lookup (or one from
  // signup mode after switching back to sign-in) simply isn't shown —
  // derived on render instead of cleared from inside the effect.
  const [preview, setPreview] = useState<{
    email: string;
    invites: InvitePreview[];
  } | null>(null);
  const trimmedEmail = email.trim().toLowerCase();
  const invitePreview =
    mode === "signup" && preview?.email === trimmedEmail
      ? preview.invites
      : [];

  // Debounced lookup of pending invites for the typed email — shown above
  // the password field to reassure the user "yes, this is the workspace
  // you were invited to". Only runs in signup mode (signins go straight in).
  useEffect(() => {
    if (mode !== "signup") return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/invites/preview?email=${encodeURIComponent(trimmedEmail)}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (!res.ok) return;
        setPreview({
          email: trimmedEmail,
          invites: (await res.json()) as InvitePreview[],
        });
      } catch {
        // ignore — abort or network blip
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmedEmail, mode]);

  // Email links (signup confirm) go through /auth/confirm with a token_hash.
  // The `?next=` is ALWAYS present — the custom Supabase email templates
  // append `&token_hash=…` to this URL, so it must already carry a query
  // string. (When Google OAuth lands, its button should redirect through
  // /auth/callback, which handles the PKCE code exchange.)
  const confirmUrl = `${
    typeof window !== "undefined" ? window.location.origin : ""
  }/auth/confirm?next=${encodeURIComponent(next ?? "/")}`;

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    const supabase = createClient();
    if (mode === "signin") {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
        setBusy(null);
        return;
      }
      // A successful password sign-in is proof of a password — backfill the
      // has_password flag for accounts that predate it, so the welcome
      // gate never asks them to "create" one they already have.
      if (!data.user?.user_metadata?.has_password) {
        await supabase.auth.updateUser({ data: { has_password: true } });
      }
      router.replace(next ?? "/");
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: confirmUrl,
          // Marks the account as password-holding so /welcome doesn't ask
          // them to create one again.
          data: { has_password: true },
        },
      });
      if (error) {
        setError(error.message);
        setBusy(null);
        return;
      }
      // If the project requires email confirmation, `session` is null and the
      // user must click the link in their inbox before we can sign them in.
      if (!data.session) {
        setSignupNeedsConfirm(true);
        setBusy(null);
        return;
      }
      router.replace(next ?? "/");
      router.refresh();
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const topRight = signupNeedsConfirm ? null : mode === "signin" ? (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => switchMode("signup")}
      disabled={busy !== null}
    >
      Sign up
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => switchMode("signin")}
      disabled={busy !== null}
    >
      Log in
    </button>
  );

  if (signupNeedsConfirm) {
    // gr8r's "verify" card.
    return (
      <AuthShell>
        <div className="auth-card fx-auth">
          <AuthCardMark icon={Mail} />
          <h1>Check your inbox</h1>
          <p className="sub">
            We sent a confirmation link to{" "}
            <b style={{ color: "var(--g8-text)" }}>{email}</b>. Click it to
            finish creating your account.
          </p>
          <p className="auth-foot">
            <button
              type="button"
              className="link"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={() => {
                setSignupNeedsConfirm(false);
                setMode("signin");
              }}
            >
              <Gi icon={ArrowLeft} size={14} />
              Back to sign in
            </button>
          </p>
        </div>
      </AuthShell>
    );
  }

  const busyLabel = mode === "signin" ? "Signing in…" : "Creating account…";

  return (
    <AuthShell topRight={topRight}>
      <form
        key={mode}
        className="auth-card fx-auth"
        onSubmit={handlePassword}
      >
        <AuthCardMark />
        <h1>{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
        <p className="sub">
          {mode === "signin"
            ? "Sign in to your Hotelclaw workspace."
            : "We'll send a confirmation email to finish setup."}
        </p>
        {error ? <AuthAlert>{error}</AuthAlert> : null}
        <div className="field">
          <label className="label" htmlFor="email">
            {mode === "signin" ? "Email" : "Work email"}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@hotel.com"
            className="input input-lg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy !== null}
          />
        </div>
        {invitePreview.length > 0 ? (
          <div className="alert info">
            <Gi icon={Mail} size={14} />
            <div className="col" style={{ gap: 6, minWidth: 0 }}>
              <b>You&apos;ve been invited to:</b>
              {invitePreview.map((inv) => (
                <span
                  key={inv.token}
                  className="row"
                  style={{ gap: 6, minWidth: 0 }}
                >
                  <Gi icon={Building2} size={13} />
                  <span style={{ fontWeight: 500 }}>{inv.propertyName}</span>
                  <span
                    className="faint"
                    style={{ textTransform: "capitalize" }}
                  >
                    · {inv.role}
                  </span>
                </span>
              ))}
              <span className="muted">
                You&apos;ll be able to accept these right after your account
                is created.
              </span>
            </div>
          </div>
        ) : null}
        <div className="field">
          <div className="row">
            <label className="label" htmlFor="password">
              Password
            </label>
            <span className="sp" />
            {mode === "signin" ? (
              <Link
                href="/forgot-password"
                className="link"
                style={{ fontSize: 12.5 }}
              >
                Forgot password?
              </Link>
            ) : null}
          </div>
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            placeholder={mode === "signup" ? "At least 8 characters" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy !== null}
          />
          {mode === "signup" ? (
            <>
              <StrengthMeter password={password} />
              <span className="hint">At least 8 characters.</span>
            </>
          ) : null}
        </div>
        <button
          type="submit"
          className={`btn btn-primary btn-lg btn-block${busy !== null ? " is-loading" : ""}`}
          disabled={busy !== null}
          aria-label={busy !== null ? busyLabel : undefined}
        >
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
        {mode === "signup" ? (
          <p className="hint" style={{ textAlign: "center" }}>
            By creating an account you agree to Hotelclaw&rsquo;s Terms and
            Privacy Policy.
          </p>
        ) : null}
        <p className="auth-foot">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                className="link"
                onClick={() => switchMode("signup")}
                disabled={busy !== null}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                className="link"
                onClick={() => switchMode("signin")}
                disabled={busy !== null}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </form>
    </AuthShell>
  );
}
