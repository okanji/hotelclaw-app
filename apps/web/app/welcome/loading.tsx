export default function WelcomeLoading() {
  // Match the welcome page's cream canvas (first beat of the setup story).
  return (
    <main className="flex min-h-svh items-center justify-center bg-guest-bg">
      <span className="inline-block size-5 animate-spin rounded-full border-2 border-guest-line border-t-guest-accent" />
    </main>
  );
}
