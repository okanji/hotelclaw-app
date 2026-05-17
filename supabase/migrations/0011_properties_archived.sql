-- Archive support for properties.
--
-- When a property's sole owner deletes their account we archive the property
-- rather than deleting it: data is preserved and remaining members simply
-- stop seeing it (the property switcher and membership lists filter on
-- archived_at). Mirrors the soft-delete pattern used for chat channels (0005)
-- and documents (0009).

alter table public.properties
  add column archived_at timestamptz;
