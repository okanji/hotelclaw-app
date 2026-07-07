"use client";

import { RouteError } from "@/components/shell/route-error";

export default function InvitesError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn’t load invites"
      message="There was a problem loading your invitations."
    />
  );
}
