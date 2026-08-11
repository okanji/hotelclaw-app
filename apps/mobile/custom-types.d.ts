import {
  DefaultAttachmentData,
  DefaultChannelData,
  DefaultCommandData,
  DefaultEventData,
  DefaultMemberData,
  DefaultMessageData,
  DefaultPollData,
  DefaultPollOptionData,
  DefaultReactionData,
  DefaultThreadData,
  DefaultUserData,
} from "stream-chat-expo";

declare module "stream-chat" {
  interface CustomAttachmentData extends DefaultAttachmentData {}
  interface CustomChannelData extends DefaultChannelData {
    // Set by apps/web/lib/stream/server.ts when channels are created — every
    // channel is stamped with its tenant property.
    property_id?: string;
    is_private?: boolean;
    // Per-channel AI reply settings, written by the web app's
    // /api/stream/ai/mode route and read by the message-new webhook.
    ai_mode?: string;
    ai_sensitivity?: string;
  }
  interface CustomCommandData extends DefaultCommandData {}
  interface CustomEventData extends DefaultEventData {}
  interface CustomMemberData extends DefaultMemberData {}
  interface CustomUserData extends DefaultUserData {}
  interface CustomMessageData extends DefaultMessageData {}
  interface CustomPollOptionData extends DefaultPollOptionData {}
  interface CustomPollData extends DefaultPollData {}
  interface CustomReactionData extends DefaultReactionData {}
  interface CustomThreadData extends DefaultThreadData {}
}
