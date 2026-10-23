import { sleep } from "eve/tools/sleep";

// Durable pause: the turn parks without holding compute and resumes after
// `seconds` (a new message ends the wait early). Lets the agent poll a slow
// external result ("check the booking again in 10 minutes") without burning a
// function the whole time.
export default sleep();
