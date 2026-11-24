-- beta_signups is written exclusively by the service role (POST /api/beta),
-- which bypasses RLS. Enabling RLS with no policies closes anon/authenticated
-- read+write access that previously exposed every signup row.
alter table public.beta_signups enable row level security;
