import React, { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  Attachment as DefaultAttachment,
  WithComponents,
  useMessageContext,
  type AttachmentProps,
} from "stream-chat-expo";
import { AiUiAttachment } from "./AiUiAttachment";
import { ArtifactCard } from "./ArtifactCard";
import { FormAttachmentCard } from "./FormAttachmentCard";
import { BotSteps, isAiSteps } from "../BotSteps";
import { asCustomAttachment, isCustomAttachment } from "./guards";

/**
 * Renders the app's custom Stream attachment types (`ai_ui`, `form`,
 * `app_artifact`) on mobile — web parity with
 * `apps/web/components/chat/slack-attachment.tsx`.
 *
 * MECHANISM (stream-chat-expo v9). Two problems rule out the obvious
 * per-attachment override:
 *
 *  1. The SDK's message-level attachment grouping
 *     (stream-chat-react-native-core `Message.tsx`) CLEARS its `other`
 *     bucket whenever the message also carries files/images/videos — so a
 *     custom attachment on a mixed message never reaches the `Attachment`
 *     component at all.
 *  2. Pure-custom messages DO reach `Attachment`, which falls through to
 *     "Unsupported Attachment".
 *
 * So rendering goes through v9's `WithComponents` override context
 * (overrides are captured ONCE at mount, hence the module-level constant):
 *
 *  - `MessageContentBottomView` — a designed extension slot rendered
 *    unconditionally, exactly once per message, at the bottom of the
 *    message bubble (`MessageItemView/MessageContent.tsx`), in both the
 *    channel list and threads. It reads the RAW `message.attachments`
 *    from `useMessageContext()`, so the grouping reducer can't drop
 *    anything: custom attachments render on pure AND mixed messages.
 *  - `Attachment` — delegates to the SDK default for every standard type,
 *    and returns null for our custom types so pure-custom messages don't
 *    ALSO render the default "Unsupported Attachment" row (which would
 *    double-render next to the bottom view).
 *
 * Standard attachments (images, galleries, files, video, audio, URL
 * previews) keep their default pipeline untouched.
 */

const CustomAttachmentList = () => {
  const { message } = useMessageContext();
  const custom = (message.attachments ?? [])
    .map(asCustomAttachment)
    .filter(<T,>(a: T | null): a is T => a !== null);
  // The runtime stamps the finished turn's steps onto the delivered reply as
  // `eve_steps` — render the collapsed "N steps · 12s" audit trail here, in
  // the same bottom slot (it must not depend on custom attachments existing).
  const steps = (message as unknown as { eve_steps?: unknown }).eve_steps;
  const hasSteps = isAiSteps(steps);
  if (custom.length === 0 && !hasSteps) return null;
  return (
    <View style={styles.container}>
      {custom.map((attachment, i) => {
        switch (attachment.type) {
          case "ai_ui":
            return <AiUiAttachment attachment={attachment} key={`ai_ui_${i}`} />;
          case "app_artifact":
            return <ArtifactCard attachment={attachment} key={`artifact_${i}`} />;
          case "form":
            return (
              <FormAttachmentCard attachment={attachment} key={`form_${attachment.form_id}`} />
            );
          default:
            return null;
        }
      })}
      {hasSteps ? <BotSteps steps={steps} /> : null}
    </View>
  );
};

/** Default pipeline for standard types; null for ours (see header comment). */
const AttachmentWithCustomTypes = (props: AttachmentProps) => {
  if (props.attachment && isCustomAttachment(props.attachment)) return null;
  return <DefaultAttachment {...props} />;
};

// Module-level constant: WithComponents memoizes its merge with an empty
// dependency list ("intentionally stable: overrides are set once at
// mount"), so the object identity must never need to change.
const overrides = {
  Attachment: AttachmentWithCustomTypes,
  MessageContentBottomView: CustomAttachmentList,
};

/**
 * Wrap a chat screen's `<Channel>` with this to activate the custom
 * attachment renderers. Used by `app/channel/[cid].tsx` and the thread
 * screen so both surfaces render them identically.
 */
export const CustomAttachmentProvider = ({ children }: { children: ReactNode }) => (
  <WithComponents overrides={overrides}>{children}</WithComponents>
);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingBottom: 4,
    gap: 4,
    alignSelf: "stretch",
  },
});
