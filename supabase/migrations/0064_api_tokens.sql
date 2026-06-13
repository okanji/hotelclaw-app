-- Property-scoped API tokens — the credential behind the MCP endpoint
-- (/api/mcp), which exposes the deterministic insights metrics to external
-- AI clients (Claude, ChatGPT, scripts). Only the SHA-256 hash is stored;
-- the plaintext (hc_<random>) is shown once at creation. Tenant isolation
-- is the token→property binding: a token can never read another property.

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_tokens_property_idx on public.api_tokens (property_id);

alter table public.api_tokens enable row level security;

-- Owners see their property's tokens (metadata only — hashes are useless
-- anyway); all writes go through owner-gated routes via the service client.
create policy api_tokens_select on public.api_tokens
  for select using (
    exists (
      select 1 from public.memberships m
      where m.property_id = api_tokens.property_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );
