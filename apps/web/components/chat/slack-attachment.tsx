"use client";

import { Attachment as DefaultAttachment, type AttachmentProps } from "stream-chat-react";
import { isAppArtifactAttachment } from "@hotelclaw/chat-ui";
import { AiUiAttachment } from "@/components/chat/ai-ui-attachment";
import { ArtifactCard } from "@/components/chat/artifact-card";
import { SlackMessageImage } from "@/components/chat/slack-message-image";
import { FormAttachmentCard } from "@/components/forms/form-attachment-card";
import type { FormAttachmentPayload } from "@/components/forms/share-actions";
import { isAiUiAttachment } from "@/lib/ai/chat-ui/catalog";

/**
 * Stream {@link DefaultAttachment} with Slack-style image presentation;
 * custom `Image` from props is respected when provided. Attachments of our
 * custom types render first — "form" (shared forms / workflow
 * `action.form.send`) as fill-in-place cards, "ai_ui" (the channel bot's
 * `render_ui` tool) as rich table/card/stat blocks; everything else falls
 * through to Stream's renderer.
 */
export function SlackAttachment(props: AttachmentProps) {
  const { Image: ImageFromProps, attachments, ...rest } = props;

  const isForm = (a: unknown): a is FormAttachmentPayload =>
    typeof a === "object" &&
    a !== null &&
    (a as { type?: unknown }).type === "form" &&
    typeof (a as { form_id?: unknown }).form_id === "string";

  const formAttachments = (attachments ?? []).filter(isForm);
  const aiUiAttachments = (attachments ?? []).filter(isAiUiAttachment);
  const artifactAttachments = (attachments ?? []).filter(isAppArtifactAttachment);
  const others = (attachments ?? []).filter(
    (a) => !isForm(a) && !isAiUiAttachment(a) && !isAppArtifactAttachment(a),
  );

  return (
    <>
      {formAttachments.map((a) => (
        <FormAttachmentCard key={a.form_id} attachment={a} />
      ))}
      {aiUiAttachments.map((a, i) => (
        <AiUiAttachment key={i} attachment={a} />
      ))}
      {artifactAttachments.map((a, i) => (
        <ArtifactCard key={a.document_id ?? i} attachment={a} />
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
