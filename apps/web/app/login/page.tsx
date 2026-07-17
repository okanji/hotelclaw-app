import { redirect } from "next/navigation";
import { ConciergeBell, Check } from "lucide-react";
import { getSessionUser, getUserMemberships } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/safe-next";
import { LoginForm } from "./login-form";

const HIGHLIGHTS = [
  "Shared channels for every team and shift",
  "Bookings, floor plans, and the day's agenda",
  "An AI brief waiting at the start of each shift",
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);

  const user = await getSessionUser();
  if (user) {
    // Already signed in — honor the destination (e.g. an invite link)
    // instead of dumping them at their first property.
    if (next) redirect(next);
    const memberships = await getUserMemberships();
    if (memberships.length === 0) redirect("/onboarding");
    redirect(`/p/${memberships[0].property_id}/home`);
  }

  return (
    <main className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand story — aubergine editorial panel, desktop only */}
      <aside className="relative hidden overflow-hidden bg-brand px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
        {/* Soft lavender glows */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-20 size-96 rounded-full bg-brand-accent/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 bottom-0 size-[28rem] rounded-full bg-brand-accent/10 blur-3xl"
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
            <ConciergeBell className="size-5 text-brand-accent" />
          </span>
          <span className="font-serif text-lg font-medium tracking-tight">
            Hotelclaw
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="font-serif text-4xl font-medium tracking-tight text-balance xl:text-5xl">
            Run the floor, not the software.
          </h2>
          <p className="mt-4 text-base text-pretty text-white/70">
            The calm command center for busy properties — every team, every
            shift, and every booking in one place.
          </p>
          <ul role="list" className="mt-9 space-y-3.5">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
                  <Check className="size-3 text-brand-accent" />
                </span>
                <span className="text-sm text-white/85">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">
          Trusted by hotels and restaurants to keep the whole property in sync.
        </p>
      </aside>

      {/* Form column — solid white, calm workspace */}
      <div className="flex min-h-svh flex-col bg-card px-6 py-10 sm:px-10">
        {/* Wordmark — shown on mobile where the brand panel is hidden */}
        <div className="flex items-center gap-2.5 lg:invisible">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
            <ConciergeBell className="size-4.5 text-primary-foreground" />
          </span>
          <span className="font-serif text-base font-medium tracking-tight">
            Hotelclaw
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <LoginForm next={next} />
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground text-pretty">
          By continuing you agree to Hotelclaw&rsquo;s Terms and Privacy
          Policy.
        </p>
      </div>
    </main>
  );
}
