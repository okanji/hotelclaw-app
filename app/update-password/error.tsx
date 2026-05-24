"use client";

import { RouteError } from "@/components/shell/route-error";

export default function UpdatePasswordError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn’t load password update"
      message="There was a problem loading the password update page."
    />
  );
}
