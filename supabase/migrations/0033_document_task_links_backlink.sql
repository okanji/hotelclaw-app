-- Doc↔task linking is bi-directional: the task side (migration 0022) already
-- lists a task's linked documents via `task_document_links` indexed by
-- `task_id`. The document side ("which tasks reference this doc?") queries the
-- same table by `document_id`, so add the matching index for the backlink
-- lookup. RLS (`task_document_links_member`, gated through the parent task's
-- property membership) already covers reads/writes from either direction —
-- no policy change needed.

create index if not exists task_document_links_document_id_idx
  on public.task_document_links (document_id);
