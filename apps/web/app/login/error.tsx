"use client";

import { RouteError } from "@/components/shell/route-error";

export default function LoginError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn’t load sign-in"
      message="There was a problem loading the sign-in page."
    />
  );
}
