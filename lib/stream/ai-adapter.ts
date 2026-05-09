import "server-only";
/**
 * Scaffolding for Stream Chat ↔ Vercel AI SDK integration.
 *
 * This file deliberately does not invoke any model in v1. The purpose is to lock
 * in the integration shape so adding an in-channel agent later is a config flip.
 *
 * Reference: https://getstream.io/chat/docs/sdk/react/guides/ai-integrations/stream-chat-ai-sdk/
 */
import type { StreamChat } from "stream-chat";

export type StreamAiHandlerOptions = {
  /** Stream user id of the bot account that participates in channels. */
  botUserId: string;
  /** Identifier for the model provider, e.g. "anthropic:claude-sonnet-4-6". */
  model: string;
  /** Optional system prompt prepended to every conversation. */
  systemPrompt?: string;
};

export type StreamAiHandler = {
  /** Attach to an existing connected StreamChat client and start listening for AI mentions. */
  attach: (client: StreamChat) => () => void;
};

/**
 * Returns a handler that *would* listen for messages addressed to the bot user
 * and stream model output back into the channel using AI_STATE_* indicators.
 *
 * Not wired in v1 — the body is a no-op. When activated:
 *   - listen for `message.new` events where the bot is mentioned
 *   - call `streamText({ model, messages, system })` from the `ai` package
 *   - forward chunks via `channel.sendEvent({ type: "ai_indicator.update", ... })`
 *   - on cancel, listen for `ai_indicator.stop` and abort the stream
 */
export function createStreamAiHandler(
  _opts: StreamAiHandlerOptions,
): StreamAiHandler {
  return {
    attach() {
      // TODO(stage 2): wire `@stream-io/chat-ai-sdk` + `streamText` from `ai`.
      return () => {};
    },
  };
}
