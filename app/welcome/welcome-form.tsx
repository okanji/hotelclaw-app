"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { toast } from "sonner";
import { completeOnboarding } from "./actions";

type Props = {
  defaultName: string;
  next: string;
};

export function WelcomeForm({ defaultName, next }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(defaultName);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await completeOnboarding({ fullName });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(`Welcome, ${fullName.trim()}`);
      router.replace(next);
      router.refresh();
    });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Welcome to Hotelclaw</CardTitle>
        <CardDescription>
          What should we call you? You can change this later in your profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full-name">Full name</Label>
            <Input
              id="full-name"
              autoFocus
              required
              minLength={1}
              maxLength={120}
              autoComplete="name"
              placeholder="Jamie Rivera"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={busy}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy || !fullName.trim()} className="w-full">
            {busy ? "Saving…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
