export default function OnboardingLoading() {
  // Match the wizard's cream canvas so the transition in doesn't flash
  // the app theme.
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf9f5]">
      <span
        className="inline-block size-5 animate-spin rounded-full border-2 border-[#dedbd2]"
        style={{ borderTopColor: "#c96442" }}
      />
    </main>
  );
}
