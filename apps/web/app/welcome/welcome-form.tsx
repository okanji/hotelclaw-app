"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  GuestBigInput,
  GuestError,
  GuestHint,
  GuestPrimaryButton,
  GuestQuestion,
} from "@/components/guest/ui";
import { completeOnboarding } from "./actions";

type Props = {
  defaultName: string;
  next: string;
  /** True for accounts that arrived via an invite/magic link and have no
   *  password yet — they must create one here or they're locked out as
   *  soon as their one-time email-link session ends. */
  askPassword: boolean;
  /** They already picked a name in a past session and are only here for
   *  the password — reframe the copy around securing the account. */
  alreadyOnboarded: boolean;
};

/**
 * The first beat of the setup story — same warm-cream, big-serif visual
 * language as the onboarding wizard. Action is untouched; only the UI
 * changed.
 */
export function WelcomeForm({
  defaultName,
  next,
  askPassword,
  alreadyOnboarded,
}: Props) {
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

  return (
    <div className="w-full max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Eyebrow tone="guest" className="mb-3">
        Welcome to Hotelclaw
      </Eyebrow>
      <GuestQuestion>
        {alreadyOnboarded ? "Secure your account" : "What should we call you?"}
      </GuestQuestion>
      <GuestHint>
        {alreadyOnboarded
          ? "One last thing — create a password so you can sign in any time. Your name is set; adjust it if you like."
          : "This is how your teammates will see you. You can change it later in your profile."}
      </GuestHint>
      <form onSubmit={onSubmit}>
        <GuestBigInput
          id="full-name"
          name="fullName"
          autoFocus
          required
          minLength={1}
          maxLength={120}
          autoComplete="name"
          placeholder="Jamie Rivera"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={busy}
          className="mt-10"
        />
        {askPassword ? (
          <div className="mt-8">
            <GuestHint>
              Create a password so you can sign back in any time — email links
              only work once.
            </GuestHint>
            <GuestBigInput
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className="mt-4"
            />
          </div>
        ) : null}
        {error ? <GuestError>{error}</GuestError> : null}
        <div className="mt-10 flex items-center gap-3">
          <GuestPrimaryButton
            disabled={
              busy ||
              !fullName.trim() ||
              (askPassword && password.length < 8)
            }
          >
            {busy ? "Saving…" : "Continue"}
          </GuestPrimaryButton>
          <span className="text-xs text-guest-ink-faint">press Enter ↵</span>
        </div>
      </form>
    </div>
  );
}
