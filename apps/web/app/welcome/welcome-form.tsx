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
};

/**
 * The first beat of the setup story — same warm-cream, big-serif visual
 * language as the onboarding wizard. Action is untouched; only the UI
 * changed.
 */
export function WelcomeForm({ defaultName, next }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(defaultName);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await completeOnboarding({ fullName });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        toast.success(`Welcome, ${fullName.trim()}`);
        router.replace(next);
        router.refresh();
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
      <GuestQuestion>What should we call you?</GuestQuestion>
      <GuestHint>
        This is how your teammates will see you. You can change it later in
        your profile.
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
        {error ? <GuestError>{error}</GuestError> : null}
        <div className="mt-10 flex items-center gap-3">
          <GuestPrimaryButton disabled={busy || !fullName.trim()}>
            {busy ? "Saving…" : "Continue"}
          </GuestPrimaryButton>
          <span className="text-xs text-guest-ink-faint">press Enter ↵</span>
        </div>
      </form>
    </div>
  );
}
