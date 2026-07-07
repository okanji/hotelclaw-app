"use client";

export default function OnboardingError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Styled to match the wizard's cream canvas rather than the app shell.
  return (
    <main className="flex min-h-svh items-center justify-center bg-[#faf9f5] px-6 text-[#1f1e1b]">
      <div className="w-full max-w-xl text-center">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[#a39e93]">
          Setup
        </p>
        <h1 className="font-serif text-3xl leading-tight text-balance sm:text-4xl">
          Couldn&rsquo;t load onboarding
        </h1>
        <p className="mt-3 text-sm text-[#6f6a60]">
          There was a problem loading the setup flow.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-8 h-11 rounded-full bg-[#c96442] px-7 text-sm font-medium text-white transition-colors hover:bg-[#b05236]"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
