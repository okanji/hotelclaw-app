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
import { createProperty } from "./actions";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createProperty({ name });
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push(`/p/${result.propertyId}/chat`);
      }
    });
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create your property</CardTitle>
        <CardDescription>
          Each hotel or restaurant is a workspace. Invite your team next.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Property name</Label>
            <Input
              id="name"
              autoFocus
              required
              placeholder="The Grand Hotel"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create property"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
