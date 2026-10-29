"use client";

import { RouteError } from "@/components/shell/route-error";

export default function WelcomeError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn’t load the welcome page"
      message="Something went wrong getting you started."
    />
  );
}
