import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description:
    "The bookings bot's allow-listed tool surface materializes (refund gate present, property memory tools present).",
  async test(t) {
    const turn = await t.send("List the exact names of the tools you can call, comma-separated.");
    t.succeeded();
    t.check(turn.message ?? "", includes("refund_booking"));
    // Memory is a first-class eve slot (agent/memory/*), qualified `property__search`.
    t.check(turn.message ?? "", includes("property__search"));
  },
});
