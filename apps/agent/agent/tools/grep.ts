import { disableTool } from "eve/tools";

// Default-harness built-in disabled: pod bots and custom agents get only
// reviewed, tenancy-scoped tools (fleet spec fail-closed posture).
export default disableTool();
