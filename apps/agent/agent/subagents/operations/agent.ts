import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Operations specialist: task board state, housekeeping/maintenance workload, stale and blocked work. Delegate task-management and operational-status questions here.",
  model: anthropic("claude-haiku-4-5-20251001"),
});
