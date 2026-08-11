import {
  isAiUiAttachment,
  isAppArtifactAttachment,
  type AiUiAttachmentPayload,
  type AppArtifactAttachment,
} from "@hotelclaw/chat-ui";

/**
 * The three custom Stream attachment types the web app renders
 * (`apps/web/components/chat/slack-attachment.tsx`). `ai_ui` and
 * `app_artifact` guards are shared via `@hotelclaw/chat-ui`; the `form`
 * guard mirrors web's inline check (`type === "form" && form_id`).
 */

export type FormAttachmentPayload = {
  type: "form";
  form_id: string;
  property_id?: string;
  title: string;
  description?: string;
  field_count?: number;
};

export function isFormAttachment(a: unknown): a is FormAttachmentPayload {
  return (
    typeof a === "object" &&
    a !== null &&
    (a as { type?: unknown }).type === "form" &&
    typeof (a as { form_id?: unknown }).form_id === "string" &&
    typeof (a as { title?: unknown }).title === "string"
  );
}

export type CustomAttachment =
  | AiUiAttachmentPayload
  | AppArtifactAttachment
  | FormAttachmentPayload;

export function asCustomAttachment(a: unknown): CustomAttachment | null {
  if (isAiUiAttachment(a)) return a;
  if (isAppArtifactAttachment(a)) return a;
  if (isFormAttachment(a)) return a;
  return null;
}

export function isCustomAttachment(a: unknown): boolean {
  return asCustomAttachment(a) !== null;
}
