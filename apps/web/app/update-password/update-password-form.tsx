"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { KeyRound } from "lucide-react";
import {
  AuthCardMark,
  AuthShell,
  FieldErr,
  PasswordInput,
  StrengthMeter,
} from "@/components/auth/auth-shell";
import { toast } from "sonner";

export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      password,
      // Marks the account as password-holding so /welcome doesn't ask
      // them to create one again.
      data: { has_password: true },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    toast.success("Password updated");
    router.replace("/");
    router.refresh();
  }

  // gr8r's "reset" card (src/pages/auth.js).
  return (
    <AuthShell>
      <form className="auth-card fx-auth" onSubmit={onSubmit}>
        <AuthCardMark icon={KeyRound} />
        <h1>Choose a new password</h1>
        <p className="sub">Pick something at least 8 characters.</p>
        <div className="field">
          <label className="label" htmlFor="password">
            New password
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
            Confirm new password
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
          Update password
        </button>
      </form>
    </AuthShell>
  );
}
