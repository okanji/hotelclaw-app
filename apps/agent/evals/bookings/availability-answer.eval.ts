import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "Availability questions are answered from the get_bookings tool, never from memory.",
  async test(t) {
    await t.send("How many bookings do we have in the next 7 days?");
    t.succeeded();
    t.calledTool("get_bookings");
  },
});
