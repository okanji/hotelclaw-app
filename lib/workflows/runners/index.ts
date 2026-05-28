import "server-only";
import type { StepType } from "@/lib/workflows/spec";
import type { Runner } from "@/lib/workflows/catalog/types";
import {
  createTaskRunner,
  updateTaskRunner,
  assignTaskRunner,
  addLabelRunner,
} from "./tasks";
import {
  postMessageRunner,
  postThreadReplyRunner,
  mentionUserRunner,
} from "./chat";
import { notifyUserRunner, notifyRoleRunner } from "./notify";
import {
  createEntityRunner,
  updateEntityRunner,
  findEntityRunner,
  deleteEntityRunner,
} from "./entities";
import {
  aiSummarizeRunner,
  aiClassifyRunner,
  aiExtractRunner,
  aiDraftReplyRunner,
  aiBranchDecisionRunner,
  aiFreeformRunner,
} from "./ai";

// Server-only runner registry. Keeping this on its own module — separate from
// the catalog metadata — is what lets client components import the catalog
// without dragging Supabase / Stream / AI SDK into the browser bundle.
//
// Control-flow runners (filter / branch_if / branch_switch / delay / wait_for_event
// / foreach / parallel / end) are handled inline by the runtimes and intentionally
// NOT in this map.

export const RUNNERS: Partial<Record<StepType, Runner>> = {
  // Tasks
  "action.task.create": createTaskRunner as Runner,
  "action.task.update": updateTaskRunner as Runner,
  "action.task.assign": assignTaskRunner as Runner,
  "action.task.add_label": addLabelRunner as Runner,

  // Chat
  "action.chat.post_message": postMessageRunner as Runner,
  "action.chat.post_thread_reply": postThreadReplyRunner as Runner,
  "action.chat.mention_user": mentionUserRunner as Runner,

  // Notify
  "action.notify.user": notifyUserRunner as Runner,
  "action.notify.role": notifyRoleRunner as Runner,

  // Entities
  "action.entity.create": createEntityRunner as Runner,
  "action.entity.update": updateEntityRunner as Runner,
  "action.entity.find": findEntityRunner as Runner,
  "action.entity.delete": deleteEntityRunner as Runner,

  // AI
  "ai.summarize_text": aiSummarizeRunner as Runner,
  "ai.classify_into": aiClassifyRunner as Runner,
  "ai.extract_fields": aiExtractRunner as Runner,
  "ai.draft_reply": aiDraftReplyRunner as Runner,
  "ai.branch_decision": aiBranchDecisionRunner as Runner,
  "ai.freeform": aiFreeformRunner as Runner,
};

export function getRunner(type: StepType): Runner | undefined {
  return RUNNERS[type];
}
