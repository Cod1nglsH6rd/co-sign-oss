-- Make the `documents` storage bucket private.
--
-- Original uploads can contain client PII (e.g. SSNs on an I-9). The bucket
-- was created public, which meant objects were addressable at the public
-- storage URL without a signed token. The application never uses
-- getPublicUrl for this bucket — every read path mints a short-lived signed
-- URL (lib/enterpriseUpload.js, lib/supabaseClient.js,
-- pages/api/sessions/[token]/document-url.js) — so flipping the bucket to
-- private closes the exposure with no functional change.
--
-- `filled-documents` was already private.

update storage.buckets
set public = false
where id = 'documents' and public is distinct from false;
