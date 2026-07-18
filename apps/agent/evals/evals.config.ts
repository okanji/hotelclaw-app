import { defineEvalConfig } from "eve/evals";

// Deterministic suite — no LLM judge. Auth comes from EVE_EVAL_AUTH_TOKEN
// (composite service bearer: <serviceKey>:<propertyId>:<userId>:<botSlug>,
// see agent/channels/eve.ts), so every eval session runs as the pod's
// `bookings` bot at Kaya.
//
// BUILD THE TOKEN IN NODE, NOT THE SHELL — zsh mangles `"$SK:uuid:..."`
// (it swallows the first colon after the expansion), which silently drops
// the composite down to localDev() auth and every tool-surface gate fails.
// Run:
//
//   cd apps/agent && EVE_EVAL_AUTH_TOKEN="$(node --env-file=../web/.env.local -e \
//     'process.stdout.write([process.env.SUPABASE_SERVICE_ROLE_KEY, "<propertyId>", "<userId>", "bookings"].join(":"))')" \
//     npx eve eval --url http://127.0.0.1:3000 --strict
export default defineEvalConfig({
  timeoutMs: 180_000,
  maxConcurrency: 2,
});
