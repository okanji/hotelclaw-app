"use client";

import { RouteError } from "@/components/shell/route-error";

export default function ForgotPasswordError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn’t load password reset"
      message="There was a problem loading the password reset page."
    />
  );
}
