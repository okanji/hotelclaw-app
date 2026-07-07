import "server-only";
import type { RunnerImpl } from "./types";

// Outbound integration runners. Each is fail-soft: when its credentials aren't
// configured it logs a stub and returns sent:false (so a workflow still runs
// during setup) rather than throwing. Real send errors (non-2xx) DO throw so
// the step's retry / on_error policy applies.

// ─── action.http.request ─────────────────────────────────────────────────────

type HttpConfig = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
};

export const httpRequestRunner: RunnerImpl<
  HttpConfig,
  { status: number; ok: boolean; body?: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { status: 200, ok: true, body: "(dry-run)" };
  const method = config.method ?? "POST";
  const sendBody = method !== "GET" && config.body != null && config.body !== "";
  const res = await fetch(config.url, {
    method,
    headers: { ...(config.headers ?? {}) },
    ...(sendBody ? { body: config.body } : {}),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`HTTP ${method} ${res.status}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, ok: true, body: text.slice(0, 2000) };
};

// ─── action.email.send (Resend) ──────────────────────────────────────────────

type EmailConfig = { to: string; subject: string; body: string; from?: string };

export const emailSendRunner: RunnerImpl<
  EmailConfig,
  { sent: boolean; id?: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { sent: true };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[workflow:email.send:stub]", {
      runId: ctx.runId,
      to: config.to,
      subject: config.subject,
    });
    return { sent: false };
  }
  const from = config.from || process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM;
  if (!from) {
    throw new Error(
      "Email step needs a sender — set RESEND_FROM_EMAIL or fill in the From field.",
    );
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: config.to, subject: config.subject, html: config.body }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { sent: true, id: body.id };
};

// ─── action.telegram.send ─────────────────────────────────────────────────────

type TelegramConfig = { chat_id: string; text: string };

export const telegramSendRunner: RunnerImpl<
  TelegramConfig,
  { sent: boolean; message_id?: number }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { sent: true };
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[workflow:telegram.send:stub]", { runId: ctx.runId, chat_id: config.chat_id });
    return { sent: false };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.chat_id, text: config.text }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Telegram ${res.status}: ${t.slice(0, 200)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { result?: { message_id?: number } };
  return { sent: true, message_id: body.result?.message_id };
};

// ─── action.whatsapp.send (Meta WhatsApp Cloud API) ──────────────────────────

type WhatsappConfig = { to: string; text: string };

export const whatsappSendRunner: RunnerImpl<
  WhatsappConfig,
  { sent: boolean; message_id?: string }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { sent: true };
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    console.log("[workflow:whatsapp.send:stub]", { runId: ctx.runId, to: config.to });
    return { sent: false };
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: config.to,
      type: "text",
      text: { body: config.text },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`WhatsApp ${res.status}: ${t.slice(0, 200)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
  return { sent: true, message_id: body.messages?.[0]?.id };
};
