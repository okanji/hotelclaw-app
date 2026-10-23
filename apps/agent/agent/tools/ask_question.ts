import { askQuestion } from "eve/tools/ask_question";

// Opt-in since eve 0.65: the model's "pause and ask the requester" tool. The
// channel renders the question (agent/channels/eve.ts input.requested →
// deliverReply) and the web glue answers it with inputResponses.
export default askQuestion();
