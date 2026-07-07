"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
      const result = await completeOnboarding({ fullName });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(`Welcome, ${fullName.trim()}`);
      router.replace(next);
      router.refresh();
    });
  }

  return (
    <div className="w-full max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[#a39e93]">
        Welcome to Hotelclaw
      </p>
      <h1 className="font-serif text-3xl leading-tight text-balance text-[#1f1e1b] sm:text-4xl">
        What should we call you?
      </h1>
      <p className="mt-3 text-sm text-[#6f6a60]">
        This is how your teammates will see you. You can change it later in
        your profile.
      </p>
      <form onSubmit={onSubmit}>
        <input
          id="full-name"
          autoFocus
          required
          minLength={1}
          maxLength={120}
          autoComplete="name"
          placeholder="Jamie Rivera"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={busy}
          className="mt-10 w-full border-0 border-b-2 border-[#dedbd2] bg-transparent pb-2 font-serif text-2xl text-[#1f1e1b] outline-none transition-colors placeholder:text-[#c5c0b4] focus:border-[#c96442] disabled:opacity-60 sm:text-3xl"
        />
        {error ? <p className="mt-4 text-sm text-[#b3422a]">{error}</p> : null}
        <div className="mt-10 flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !fullName.trim()}
            className="h-11 rounded-full bg-[#c96442] px-7 text-sm font-medium text-white transition-colors hover:bg-[#b05236] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Continue"}
          </button>
          <span className="text-xs text-[#a39e93]">press Enter ↵</span>
        </div>
      </form>
    </div>
  );
}
