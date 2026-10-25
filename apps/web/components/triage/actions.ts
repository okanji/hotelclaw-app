"use server";

import { createClient } from "@/lib/supabase/server";
import { createTaskFor, type CreateTaskInput } from "@/lib/tasks/mutations";
import {
  acceptTriageTaskFor,
  declineTriageTaskFor,
  type AcceptTriageSchema,
  type DeclineTriageSchema,
} from "@/lib/tasks/triage-queue";
import type { z } from "zod";

// Triage writes live in lib/tasks/triage-queue (and createTaskFor) so the
// REST routes (mobile, Bearer) and these actions (web, cookie) can't diverge.
// No revalidatePath: the board and the queue are client-rendered off React
// Query, and the caller invalidates those caches itself.

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function acceptTriageTask(
  input: z.input<typeof AcceptTriageSchema>,
): Promise<{ ok: true } | { error: string }> {
  const { supabase, user } = await caller();
  if (!user) return { error: "Not signed in" };
  const result = await acceptTriageTaskFor(supabase, user.id, input);
  return "error" in result ? result : { ok: true };
}

export async function declineTriageTask(
  input: z.input<typeof DeclineTriageSchema>,
): Promise<{ ok: true } | { error: string }> {
  const { supabase, user } = await caller();
  if (!user) return { error: "Not signed in" };
  const result = await declineTriageTaskFor(supabase, user.id, input);
  return "error" in result ? result : { ok: true };
}

/** "Create triage issue" — a normal create, held in the queue. */
export async function submitToTriage(
  input: Omit<CreateTaskInput, "triage">,
): Promise<{ taskId: string } | { error: string }> {
  const { supabase, user } = await caller();
  if (!user) return { error: "Not signed in" };
  const result = await createTaskFor(supabase, user.id, { ...input, triage: true });
  return "error" in result ? result : { taskId: result.taskId };
}
