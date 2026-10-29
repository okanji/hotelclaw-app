"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  acceptInvite,
  requestInviteAccess,
  switchAccountForInvite,
} from "@/lib/invites/actions";

export function AcceptButton({
  token,
  block = false,
}: {
  token: string;
  /** Full-width large (the single-invite card) vs inline (a list row). */
  block?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function accept() {
    startTransition(async () => {
      const result = await acceptInvite(token);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Welcome to ${result.propertyName}`);
      router.push(`/p/${result.propertyId}/home`);
    });
  }

  return (
    <button
      type="button"
      className={`btn btn-primary${block ? " btn-lg btn-block" : ""}${pending ? " is-loading" : ""}`}
      onClick={accept}
      disabled={pending}
    >
      Accept invite
    </button>
  );
}

/** Shown instead of Accept when the signed-in email ≠ the invited email:
 *  signs this session out and returns to the invite after re-login. */
export function SwitchAccountButton({
  token,
  invitedEmail,
}: {
  token: string;
  invitedEmail: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn btn-primary btn-lg btn-block"
      onClick={() => startTransition(() => switchAccountForInvite(token))}
      disabled={pending}
    >
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {pending ? "Signing out…" : `Sign in as ${invitedEmail}`}
      </span>
    </button>
  );
}

/** The escape hatch for people who can't sign in as the invited address —
 *  a mistyped or stale one. Pings the inviter with the address they do use,
 *  instead of leaving them to chase it down off-app. */
export function RequestAccessButton({
  token,
  myEmail,
}: {
  token: string;
  myEmail: string;
}) {
  const [pending, startTransition] = useTransition();
  const [asked, setAsked] = useState(false);

  function ask() {
    startTransition(async () => {
      const result = await requestInviteAccess(token);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setAsked(true);
      toast.success(
        result.notified
          ? "We let them know. They'll re-send it to you."
          : "Request noted — but no one is left to notify on this property.",
      );
    });
  }

  if (asked) {
    return (
      <div className="alert ok">
        <span>
          Asked them to re-send it to{" "}
          <b style={{ wordBreak: "break-all" }}>{myEmail}</b>.
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`btn btn-secondary btn-lg btn-block${pending ? " is-loading" : ""}`}
      onClick={ask}
      disabled={pending}
    >
      Ask them to send it to me instead
    </button>
  );
}
