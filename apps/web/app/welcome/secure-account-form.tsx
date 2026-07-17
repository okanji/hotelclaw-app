"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { completeOnboarding } from "./actions";

type Props = {
  /** Their existing display name — submitted unchanged; this screen is
   *  only about the password. */
  fullName: string;
  email: string;
  next: string;
};

/**
 * Auth-style variant of the welcome step for accounts that already picked a
 * name but have no password (invite/magic-link-born, onboarded before the
 * password step existed). Mirrors /update-password's card — this is an auth
 * moment, not onboarding.
 */
export function SecureAccountForm({ fullName, email, next }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await completeOnboarding({ fullName, password });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        toast.success("Password saved");
        // No router.refresh() — refreshing /welcome inside this transition
        // re-runs its server component, which now redirects, and that
        // response cancels the in-flight replace (the "Saving…" deadlock).
        router.replace(next);
      } catch {
        setError("Couldn't save that — check your connection and try again.");
      }
    });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Secure your account</CardTitle>
        <CardDescription>
          Create a password for{" "}
          <span className="font-medium text-foreground">{email}</span> so you
          can sign in any time — email links only work once.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Saving…" : "Save password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
