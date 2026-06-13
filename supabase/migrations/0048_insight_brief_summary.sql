-- The metrics explainer: a short plain-language paragraph, generated in the
-- same model call as the brief's insight cards, that narrates what the lens's
-- charts show (flow balance, open work, cycle time). Nullable — rows written
-- before this column regenerate it on their next fingerprint change.

alter table public.insight_briefs
  add column summary text;
