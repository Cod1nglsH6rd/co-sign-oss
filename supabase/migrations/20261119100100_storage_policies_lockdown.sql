-- Close the filled-documents storage policy that was open to anyone.
--
-- SUPABASE-SETUP.sql created "Service role can manage filled documents" as
-- FOR ALL with no TO role and USING (bucket_id = 'filled-documents'), so it
-- applied to every role, anon included: anyone could list, read, overwrite
-- and delete filled PDFs. The service role bypasses RLS and never needed it.
-- Org members keep reading through "Org members can read filled documents".
--
-- Both buckets are also made sure to exist and to be private.

drop policy if exists "Service role can manage filled documents" on storage.objects;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  52428800,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']
)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'filled-documents',
  'filled-documents',
  false,
  52428800,
  array['application/pdf']
)
on conflict (id) do update set public = false;
