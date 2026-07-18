-- Fleet v2: single shared gbrain server. The endpoint becomes global env
-- (BRAIN_MCP_URL); per-client tenancy moves to OAuth clients bound to a
-- SOURCE on the shared server. brain_client_secret_ref names the env var
-- holding the OAuth client credential ("clientId:clientSecret" composite —
-- client id is non-secret but shipping them together keeps one ref;
-- brain_client_id is stored for audit/ops tooling).
alter table public.clients drop column if exists brain_url;
alter table public.clients rename column brain_token_ref to brain_client_secret_ref;
alter table public.clients add column if not exists brain_source text not null default '';
alter table public.clients add column if not exists brain_client_id text not null default '';
