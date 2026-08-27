/**
 * Sampling-parameter guard for model families that removed them.
 *
 * Claude Sonnet 5, Opus 5, Opus 4.7/4.8, and Fable/Mythos reject
 * `temperature` (and top_p/top_k) with a 400 — adaptive-thinking models own
 * their own sampling. Older families (Sonnet/Opus 4.6, Haiku 4.5) still
 * accept it. Spread the result into generateText/streamText instead of
 * passing `temperature` directly, so a model swap — including an env
 * override like AI_BOT_MODEL — can never turn every call into a 400.
 */
const REJECTS_SAMPLING = /claude-(sonnet-5|opus-5|opus-4-[78]|fable|mythos)/;

export function samplingParams(
  modelId: string,
  temperature: number,
): { temperature?: number } {
  return REJECTS_SAMPLING.test(modelId) ? {} : { temperature };
}
