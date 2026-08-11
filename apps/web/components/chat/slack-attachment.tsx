"use client";

import { Attachment as DefaultAttachment, type AttachmentProps } from "stream-chat-react";
import type { Attachment as StreamAttachment } from "stream-chat";
import { isAppArtifactAttachment } from "@hotelclaw/chat-ui";
import { AiUiAttachment } from "@/components/chat/ai-ui-attachment";
import { ArtifactCard } from "@/components/chat/artifact-card";
import { SlackGallery } from "@/components/chat/slack-gallery";
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

  // 2+ plain images would otherwise be folded by Stream into a synthetic
  // `gallery` attachment whose grid bypasses the custom `Image` component —
  // losing all the Slack card chrome. Pull them out and render SlackGallery
  // instead (scraped link previews keep their image and stay with Card).
  // `others` can also carry SharedLocationResponse (SlackMessageUI prepends
  // `message.shared_location`), which has none of these fields — the property
  // probe narrows it away.
  const isPlainImage = (a: (typeof others)[number]): a is StreamAttachment => {
    const att = a as { type?: unknown; og_scrape_url?: unknown; title_link?: unknown };
    return att.type === "image" && !att.og_scrape_url && !att.title_link;
  };
  const galleryImages = others.filter(isPlainImage);
  const useSlackGallery = galleryImages.length >= 2;
  const defaultAttachments = useSlackGallery
    ? others.filter((a) => !isPlainImage(a))
    : others;

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
      {useSlackGallery ? <SlackGallery images={galleryImages} /> : null}
      {defaultAttachments.length > 0 ? (
        <DefaultAttachment
          {...rest}
          attachments={defaultAttachments}
          Image={ImageFromProps ?? SlackMessageImage}
        />
      ) : null}
    </>
  );
}
