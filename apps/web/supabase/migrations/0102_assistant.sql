-- Personal AI assistant (the Assistant rail section) — a private, tabbed
-- chat surface per user, with Claude-style Projects grouping conversations
-- under shared instructions, memory, and context.
--
-- Everything here is PERSONAL: rows are visible only to the user who owns
-- them, inside a property they are a member of. That is the whole point of
-- the surface — the assistant runs with the user's own scope (their tasks,
-- their channels, their DMs), so its conversations must never be readable by
-- a teammate the way `agents` / `chatbots` deliberately are.
--
-- Generation runs on eve: one durable session per conversation, addressed by
-- `x-hotelclaw-bot: assistant` (+ optional `x-hotelclaw-project`). The rows
-- below hold only what the app needs to LIST and RESUME — the transcript
-- itself lives in the eve session's event log, exactly like the Agents
-- section (agent_sessions).

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create table public.assistant_projects (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  -- Prepended to every chat in the project (Claude's "Instructions" card).
  instructions text,
  -- Durable notes the project carries between chats ("Memory"). Free text,
  -- edited by the human; the assistant may propose but never silently
  -- rewrites it.
  memory text,
  -- Cosmetics: an emoji + one of the tint palette keys.
  emoji text not null default '📁',
  tint text not null default 'lavender',
  pinned boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assistant_projects_list_idx
  on public.assistant_projects (property_id, user_id, pinned desc, updated_at desc);

create trigger assistant_projects_touch_updated_at
  before update on public.assistant_projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Project context ("Add PDFs, documents, or other text to reference")
-- ---------------------------------------------------------------------------
-- Two kinds, deliberately: a REFERENCE to an app document (the live doc is
-- read through the assistant's read_document tool, so it never goes stale)
-- and inline TEXT pasted by the user. File upload rides on the existing
-- document attachment pipeline rather than growing a second one.

create table public.assistant_project_resources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.assistant_projects(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('document', 'text')),
  document_id uuid references public.documents(id) on delete cascade,
  title text not null,
  -- Only for kind = 'text'. Capped in the app layer, not here.
  body text,
  created_at timestamptz not null default now(),
  -- A document resource points at a document; a text resource carries a body.
  constraint assistant_project_resources_shape check (
    (kind = 'document' and document_id is not null)
    or (kind = 'text' and body is not null)
  )
);

create index assistant_project_resources_project_idx
  on public.assistant_project_resources (project_id, created_at);

-- ---------------------------------------------------------------------------
-- Chats
-- ---------------------------------------------------------------------------
-- `id` is eve's session id (wrun_…) once the first turn lands. Chats are
-- created optimistically in the browser BEFORE that id exists, so the PK is
-- our own uuid and the eve id is a nullable column filled on first reply —
-- which also lets a chat exist with a typed-but-unsent draft.

create table public.assistant_chats (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.assistant_projects(id) on delete set null,
  title text not null default 'New chat',
  eve_session_id text,
  continuation_token text,
  pinned boolean not null default false,
  archived_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assistant_chats_list_idx
  on public.assistant_chats (property_id, user_id, last_message_at desc);
create index assistant_chats_project_idx
  on public.assistant_chats (project_id, last_message_at desc);
create unique index assistant_chats_eve_session_idx
  on public.assistant_chats (eve_session_id)
  where eve_session_id is not null;

create trigger assistant_chats_touch_updated_at
  before update on public.assistant_chats
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — personal, membership-scoped
-- ---------------------------------------------------------------------------

alter table public.assistant_projects enable row level security;
alter table public.assistant_project_resources enable row level security;
alter table public.assistant_chats enable row level security;

create policy assistant_projects_select on public.assistant_projects
  for select using (user_id = auth.uid() and public.is_member(property_id));
create policy assistant_projects_insert on public.assistant_projects
  for insert with check (user_id = auth.uid() and public.is_member(property_id));
create policy assistant_projects_update on public.assistant_projects
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy assistant_projects_delete on public.assistant_projects
  for delete using (user_id = auth.uid());

create policy assistant_project_resources_select on public.assistant_project_resources
  for select using (user_id = auth.uid() and public.is_member(property_id));
create policy assistant_project_resources_insert on public.assistant_project_resources
  for insert with check (user_id = auth.uid() and public.is_member(property_id));
create policy assistant_project_resources_update on public.assistant_project_resources
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy assistant_project_resources_delete on public.assistant_project_resources
  for delete using (user_id = auth.uid());

create policy assistant_chats_select on public.assistant_chats
  for select using (user_id = auth.uid() and public.is_member(property_id));
create policy assistant_chats_insert on public.assistant_chats
  for insert with check (user_id = auth.uid() and public.is_member(property_id));
create policy assistant_chats_update on public.assistant_chats
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy assistant_chats_delete on public.assistant_chats
  for delete using (user_id = auth.uid());

-- The sidebar's recents list and the tab strip's titles stay live without
-- polling (house rule: push via postgres_changes, never refetchInterval).
alter publication supabase_realtime add table public.assistant_chats;
alter publication supabase_realtime add table public.assistant_projects;
