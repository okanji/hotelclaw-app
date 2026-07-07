"use client";

import { Attachment as DefaultAttachment, type AttachmentProps } from "stream-chat-react";
import { SlackMessageImage } from "@/components/chat/slack-message-image";
import { FormAttachmentCard } from "@/components/forms/form-attachment-card";
import type { FormAttachmentPayload } from "@/components/forms/share-actions";

/**
 * Stream {@link DefaultAttachment} with Slack-style image presentation;
 * custom `Image` from props is respected when provided. Attachments of our
 * custom type "form" (shared forms / workflow `action.form.send`) render as
 * fill-in-place cards; everything else falls through to Stream's renderer.
 */
export function SlackAttachment(props: AttachmentProps) {
  const { Image: ImageFromProps, attachments, ...rest } = props;

  const isForm = (a: unknown): a is FormAttachmentPayload =>
    typeof a === "object" &&
    a !== null &&
    (a as { type?: unknown }).type === "form" &&
    typeof (a as { form_id?: unknown }).form_id === "string";

  const formAttachments = (attachments ?? []).filter(isForm);
  const others = (attachments ?? []).filter((a) => !isForm(a));

  return (
    <>
      {formAttachments.map((a) => (
        <FormAttachmentCard key={a.form_id} attachment={a} />
      ))}
      {others.length > 0 ? (
        <DefaultAttachment
          {...rest}
          attachments={others}
          Image={ImageFromProps ?? SlackMessageImage}
        />
      ) : null}
    </>
  );
}
