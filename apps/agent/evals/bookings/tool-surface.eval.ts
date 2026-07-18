import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description:
    "The bookings bot's allow-listed tool surface materializes (refund gate present, brain tools present).",
  async test(t) {
    await t.send("List the exact names of the tools you can call, comma-separated.");
    t.succeeded();
    t.check(t.reply, includes("refund_booking"));
    t.check(t.reply, includes("brain_query"));
  },
});
