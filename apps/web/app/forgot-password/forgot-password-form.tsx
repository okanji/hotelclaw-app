"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // `?next=` must be present: the custom recovery email template appends
    // `&token_hash=…` to this URL. (type=recovery routes to /update-password
    // in /auth/confirm regardless.)
    const redirectTo = `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/update-password")}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            If an account exists for{" "}
            <span className="font-medium text-foreground">{email}</span>, we
            sent a password-reset link.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="ghost" nativeButton={false} render={<Link href="/login" />}>
            Back to sign in
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          We'll email you a link to set a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@hotel.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <Button variant="ghost" nativeButton={false} render={<Link href="/login" />}>
          Back to sign in
        </Button>
      </CardFooter>
    </Card>
  );
}
