import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Bookings specialist: check availability windows, look up bookings by reference or date, and reason about rates from the property's documented rate pages. Delegate booking/availability/rate questions here.",
  model: anthropic("claude-sonnet-4-6"),
});
