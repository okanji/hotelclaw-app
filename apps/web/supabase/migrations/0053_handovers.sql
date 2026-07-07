-- Shift handovers — the human-published note drafted by AI from the shift
-- window's deterministic activity. The Stream channel message is the actual
-- communication; this row is the history (and lets the next person's shift
-- brief cite the previous handover).

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body_md text not null,
  window_start timestamptz,
  window_end timestamptz,
  channel_id uuid references public.chat_channels(id) on delete set null,
  chat_message_id text,
  created_at timestamptz not null default now()
);

create index handovers_property_created_idx
  on public.handovers (property_id, created_at desc);

alter table public.handovers enable row level security;

-- Any member reads the property's handovers; inserts go through the publish
-- route's service-role client (which validates membership itself).
create policy handovers_select on public.handovers
  for select using (
    exists (
      select 1 from public.memberships m
      where m.property_id = handovers.property_id
        and m.user_id = auth.uid()
    )
  );
