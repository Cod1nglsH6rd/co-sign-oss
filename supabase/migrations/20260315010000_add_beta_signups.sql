create table if not exists public.beta_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  locale text default 'en',
  source text default 'landing',
  created_at timestamp with time zone default now()
);
