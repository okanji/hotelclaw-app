-- Link chat channels to a Space (optional). Gives each department a home
-- channel; null = a general property-wide channel (unchanged behavior). RLS on
-- chat_channels is unchanged (still property-member scoped); space_id is just an
-- organizational tag.

alter table public.chat_channels
  add column space_id uuid references public.spaces(id) on delete set null;

create index chat_channels_space_id_idx on public.chat_channels (space_id);
