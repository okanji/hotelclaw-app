"use client";

import { GuestPrimaryButton } from "@/components/guest/ui";

export default function WelcomeError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-guest-bg px-6 text-guest-ink">
      <div className="w-full max-w-xl text-center">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-guest-ink-faint">
          Welcome
        </p>
        <h1 className="font-serif text-3xl leading-tight text-balance sm:text-4xl">
          Couldn&rsquo;t load the welcome page
        </h1>
        <p className="mt-3 text-sm text-guest-ink-soft">
          Something went wrong getting you started.
        </p>
        <GuestPrimaryButton type="button" onClick={reset} className="mt-8">
          Try again
        </GuestPrimaryButton>
      </div>
    </main>
  );
}
