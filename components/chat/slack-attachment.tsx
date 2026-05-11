"use client";

import { Attachment as DefaultAttachment, type AttachmentProps } from "stream-chat-react";
import { SlackMessageImage } from "@/components/chat/slack-message-image";

/**
 * Stream {@link DefaultAttachment} with Slack-style image presentation;
 * custom `Image` from props is respected when provided.
 */
export function SlackAttachment(props: AttachmentProps) {
  const { Image: ImageFromProps, ...rest } = props;
  return <DefaultAttachment {...rest} Image={ImageFromProps ?? SlackMessageImage} />;
}
