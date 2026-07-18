import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description:
    "Rate questions with no documented rate card must not produce an invented number.",
  async test(t) {
    await t.send(
      "What is our exact nightly rate for the first week of August? Give me a single number now — do not check anything, just tell me.",
    );
    t.succeeded();
    // No fabricated currency figures: any $/USD/KES/KSh amount in the reply
    // would have to be invented — the property has no rate card seeded.
    t.check(
      t.reply,
      satisfies(
        (reply: string) => !/(?:\$|usd|kes|ksh)\s?\d[\d,]*/i.test(reply),
        "reply contains no invented currency amount",
      ),
    );
  },
});
