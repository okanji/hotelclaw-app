"use client";

import { RouteError } from "@/components/shell/route-error";

export default function OnboardingError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn’t load onboarding"
      message="There was a problem loading the onboarding flow."
    />
  );
}
