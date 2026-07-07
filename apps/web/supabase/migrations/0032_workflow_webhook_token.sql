-- Inbound webhook / hosted-form triggers.
--
-- A workflow whose trigger is `webhook.received` or `form.submitted` is started
-- by an external HTTP POST to a per-workflow URL. The URL carries an unguessable
-- token (this column) so anyone with the URL can trigger the workflow but the
-- workflow id alone is not enough. See app/api/workflows/webhook/[token]/route.ts.

alter table public.workflows
  add column if not exists webhook_token uuid not null default gen_random_uuid();

create unique index if not exists workflows_webhook_token_idx
  on public.workflows (webhook_token);
