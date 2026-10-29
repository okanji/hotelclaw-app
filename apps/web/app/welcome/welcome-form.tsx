"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Hand } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  AuthAlert,
  AuthCardMark,
  AuthShell,
  PasswordInput,
  StrengthMeter,
} from "@/components/auth/auth-shell";
import { completeOnboarding } from "./actions";

type Props = {
  defaultName: string;
  next: string;
  /** True for accounts that arrived via an invite/magic link and have no
   *  password yet — they must create one here or they're locked out as
   *  soon as their one-time email-link session ends. */
  askPassword: boolean;
};

/**
 * The first beat of the setup story — gr8r's auth card (same frame as the
 * onboarding wizard). Action is untouched; only the UI changed.
 */
export function WelcomeForm({ defaultName, next, askPassword }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    if (askPassword && password.length < 8) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await completeOnboarding({
          fullName,
          password: askPassword ? password : undefined,
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        toast.success(`Welcome, ${fullName.trim()}`);
        // No router.refresh() here: refreshing /welcome inside this async
        // transition re-runs its server component, which now redirects
        // (onboarded_at is set) — and that response races and cancels the
        // in-flight replace, leaving the button stuck on "Saving…" while the
        // URL never changes. The replace alone fetches the target fresh.
        router.replace(next);
      } catch {
        // A thrown server action (network drop, server error) used to die
        // silently here, leaving the button stuck on "Saving…".
        setError(
          "Couldn't save that — check your connection and try again.",
        );
      }
    });
  }

  const ready =
    !busy && fullName.trim() !== "" && (!askPassword || password.length >= 8);

  return (
    <AuthShell>
      <form className="auth-card fx-auth" onSubmit={onSubmit}>
        <AuthCardMark icon={Hand} />
        <h1>What should we call you?</h1>
        <p className="sub">
          Welcome to Hotelclaw. This is how your teammates will see you — you
          can change it later in your profile.
        </p>
        <div className="field">
          <label className="label" htmlFor="full-name">
            Full name
          </label>
          <input
            id="full-name"
            name="fullName"
            autoFocus
            required
            minLength={1}
            maxLength={120}
            autoComplete="name"
            placeholder="Jamie Rivera"
            className="input input-lg"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={busy}
          />
        </div>
        {askPassword ? (
          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <PasswordInput
              id="password"
              name="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            <StrengthMeter password={password} />
            <span className="hint">
              Create a password so you can sign back in any time — email links
              only work once.
            </span>
          </div>
        ) : null}
        {error ? <AuthAlert>{error}</AuthAlert> : null}
        <button
          type="submit"
          className={`btn btn-primary btn-lg btn-block${busy ? " is-loading" : ""}`}
          disabled={!ready}
        >
          Continue
          <Gi icon={ArrowRight} size={15} />
        </button>
      </form>
    </AuthShell>
  );
}
