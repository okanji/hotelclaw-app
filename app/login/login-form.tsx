"use client";

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

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const callbackUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/auth/callback${
    next ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    });
    if (error) {
      setStatus("error");
      setError(error.message);
    } else {
      setStatus("sent");
    }
  }

  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl },
    });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to Hotelclaw</CardTitle>
        <CardDescription>
          Email magic link or continue with Google.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === "sent" ? (
          <p className="text-sm text-muted-foreground">
            Check <span className="font-medium text-foreground">{email}</span>{" "}
            for the sign-in link.
          </p>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                required
                placeholder="you@hotel.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "sending"}
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <Button
              type="submit"
              disabled={status === "sending"}
              className="w-full"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or
          <div className="h-px flex-1 bg-border" />
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={signInWithGoogle}
          type="button"
        >
          Continue with Google
        </Button>
      </CardFooter>
    </Card>
  );
}
