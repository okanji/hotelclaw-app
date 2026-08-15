import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Booking lookups go through get_booking and echo the reference.",
  async test(t) {
    await t.send("Look up booking BKG-WTMU02 and summarize it in one line.");
    t.succeeded();
    t.calledTool("get_booking");
    t.check(t.reply, includes("BKG-WTMU02"));
  },
});
