"use client";

import { RouteError } from "@/components/shell/route-error";

export default function WelcomeError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn’t load welcome page"
      message="There was a problem loading your welcome page."
    />
  );
}
