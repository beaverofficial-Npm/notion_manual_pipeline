insert into storage.buckets (id, name, public)
values
  ('manual-source', 'manual-source', false),
  ('manual-renders', 'manual-renders', false),
  ('manual-assets', 'manual-assets', false),
  ('manual-manifests', 'manual-manifests', false)
on conflict (id) do update set public = excluded.public;
