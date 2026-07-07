"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { Building2, Mail } from "lucide-react";

type Mode = "signin" | "signup";

type InvitePreview = {
  token: string;
  role: string;
  propertyName: string;
};

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<
    null | "password" | "magic" | "google"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [signupNeedsConfirm, setSignupNeedsConfirm] = useState(false);
  const [invitePreview, setInvitePreview] = useState<InvitePreview[]>([]);

  // Debounced lookup of pending invites for the typed email — shown above
  // the password field to reassure the user "yes, this is the workspace
  // you were invited to". Only runs in signup mode (signins go straight in).
  useEffect(() => {
    if (mode !== "signup") {
      setInvitePreview([]);
      return;
    }
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setInvitePreview([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/invites/preview?email=${encodeURIComponent(trimmed)}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (!res.ok) return;
        setInvitePreview((await res.json()) as InvitePreview[]);
      } catch {
        // ignore — abort or network blip
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [email, mode]);

  const callbackUrl = `${
    typeof window !== "undefined" ? window.location.origin : ""
  }/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const confirmUrl = `${
    typeof window !== "undefined" ? window.location.origin : ""
  }/auth/confirm${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    const supabase = createClient();
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
        setBusy(null);
        return;
      }
      router.replace(next ?? "/");
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: confirmUrl },
      });
      if (error) {
        setError(error.message);
        setBusy(null);
        return;
      }
      // If the project requires email confirmation, `session` is null and the
      // user must click the link in their inbox before we can sign them in.
      if (!data.session) {
        setSignupNeedsConfirm(true);
        setBusy(null);
        return;
      }
      router.replace(next ?? "/");
      router.refresh();
    }
  }

  async function sendMagicLink() {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setBusy("magic");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl },
    });
    if (error) {
      setError(error.message);
      setBusy(null);
      return;
    }
    setMagicLinkSent(true);
    setBusy(null);
  }

  async function signInWithGoogle() {
    setBusy("google");
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl },
    });
  }

  if (signupNeedsConfirm) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground">{email}</span>. Click
            it to finish creating your account.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (magicLinkSent) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            We sent a sign-in link to{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          {mode === "signin" ? "Sign in to Hotelclaw" : "Create your account"}
        </CardTitle>
        <CardDescription>
          {mode === "signin"
            ? "Email and password, magic link, or Google."
            : "We'll send a confirmation email to finish setup."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handlePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@hotel.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy !== null}
            />
          </div>
          {invitePreview.length > 0 ? (
            <div className="rounded-md border bg-muted/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                <Mail className="size-3.5" />
                You've been invited to:
              </div>
              <ul className="space-y-1.5">
                {invitePreview.map((inv) => (
                  <li
                    key={inv.token}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Building2 className="size-3.5 text-muted-foreground" />
                    <span className="font-medium">{inv.propertyName}</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      · {inv.role}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                You'll be added automatically after your account is created.
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {mode === "signin" ? (
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Forgot password?
                </Link>
              ) : null}
            </div>
            <Input
              id="password"
              type="password"
              required
              minLength={mode === "signup" ? 8 : 1}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              placeholder={mode === "signup" ? "At least 8 characters" : ""}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy !== null}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
          <Button
            type="submit"
            disabled={busy !== null}
            className="w-full"
          >
            {busy === "password"
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {mode === "signin" ? (
            <>
              No account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="font-medium text-foreground underline-offset-2 hover:underline"
                disabled={busy !== null}
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className="font-medium text-foreground underline-offset-2 hover:underline"
                disabled={busy !== null}
              >
                Sign in
              </button>
            </>
          )}
        </p>
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
          type="button"
          onClick={sendMagicLink}
          disabled={busy !== null}
        >
          {busy === "magic" ? "Sending…" : "Send magic link"}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={signInWithGoogle}
          type="button"
          disabled={busy !== null}
        >
          Continue with Google
        </Button>
      </CardFooter>
    </Card>
  );
}
