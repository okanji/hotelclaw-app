"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import {
  AuthCardMark,
  AuthShell,
  FieldErr,
  PasswordInput,
  StrengthMeter,
} from "@/components/auth/auth-shell";
import { completeOnboarding } from "./actions";

type Props = {
  /** Their existing display name — submitted unchanged; this screen is
   *  only about the password. */
  fullName: string;
  email: string;
  next: string;
};

/**
 * Auth-style variant of the welcome step for accounts that already picked a
 * name but have no password (invite/magic-link-born, onboarded before the
 * password step existed). Mirrors /update-password's card — this is an auth
 * moment, not onboarding.
 */
export function SecureAccountForm({ fullName, email, next }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await completeOnboarding({ fullName, password });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        toast.success("Password saved");
        // No router.refresh() — refreshing /welcome inside this transition
        // re-runs its server component, which now redirects, and that
        // response cancels the in-flight replace (the "Saving…" deadlock).
        router.replace(next);
      } catch {
        setError("Couldn't save that — check your connection and try again.");
      }
    });
  }

  // gr8r's "reset" card shape — this is an auth moment, not onboarding.
  return (
    <AuthShell>
      <form className="auth-card fx-auth" onSubmit={onSubmit}>
        <AuthCardMark icon={ShieldCheck} />
        <h1>Secure your account</h1>
        <p className="sub">
          Create a password for{" "}
          <b style={{ color: "var(--g8-text)" }}>{email}</b> so you can sign in
          any time — email links only work once.
        </p>
        <div className="field">
          <label className="label" htmlFor="password">
            Password
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            autoFocus
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <StrengthMeter password={password} />
        </div>
        <div className="field">
          <label className="label" htmlFor="confirm">
            Confirm password
          </label>
          <PasswordInput
            id="confirm"
            name="confirmPassword"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            className={error ? "is-error" : undefined}
            aria-invalid={error ? true : undefined}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
          {error ? <FieldErr>{error}</FieldErr> : null}
        </div>
        <button
          type="submit"
          className={`btn btn-primary btn-lg btn-block${busy ? " is-loading" : ""}`}
          disabled={busy}
        >
          Save password
        </button>
      </form>
    </AuthShell>
  );
}
