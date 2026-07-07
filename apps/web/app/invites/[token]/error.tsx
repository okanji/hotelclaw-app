"use client";

import { RouteError } from "@/components/shell/route-error";

export default function InviteTokenError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn’t load invitation"
      message="This invite link couldn’t be loaded. It may have expired or been revoked."
    />
  );
}
