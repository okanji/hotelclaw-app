-- Actions MCP surface (fleet spec M5): api_tokens gain a per-key tool
-- allow-list. Legacy insights tokens default to '{}' — they keep working on
-- the read-only /api/mcp endpoint and get NOTHING on the actions endpoint
-- (fail-closed). Property binding remains the tenant isolation; a key for
-- client A's property structurally cannot touch client B.
alter table public.api_tokens
  add column if not exists allowed_tools text[] not null default '{}';
