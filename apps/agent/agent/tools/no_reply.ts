import { noReply } from "eve/tools/no_reply";

// Ends the turn without a reply. Scheduled sweeps and auto-mode activations
// call it when there is nothing worth saying — a turn that stays quiet on
// purpose instead of a hollow "nothing to report" message.
export default noReply();
