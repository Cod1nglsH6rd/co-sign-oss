-- =====================================================
-- Cô Sign - Supabase Database Setup
-- Run this in your Supabase SQL Editor
-- =====================================================

-- 1. ORGANIZATIONS + MEMBERSHIPS
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text default 'enterprise',
  retention_days integer default 365,
  created_at timestamp with time zone default now()
);

create table if not exists public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text default 'admin',
  status text default 'active',
  created_at timestamp with time zone default now(),
  unique (org_id, user_id)
);

-- 2. DOCUMENTS TABLE
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  user_id text, -- legacy: the uploader's auth uid as text (as on the hosted database; the migrations compare it with auth.uid()::text)
  created_by uuid references auth.users(id) on delete set null,
  file_name text not null,
  file_path text not null,
  file_url text not null,
  file_size integer,
  file_type varchar(50),
  status varchar(50) default 'uploaded',
  processing_status text default 'idle',
  lifecycle_status text default 'uploaded',
  page_count integer,
  has_rect boolean default false,
  preferred_language varchar(8),
  completion_count integer default 0,
  metadata jsonb default '{}'::jsonb,
  phase1_data jsonb default '{}'::jsonb,
  is_multi_party boolean default false,
  document_type text default 'unknown',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- BETA SIGNUPS
create table if not exists public.beta_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  locale text default 'en',
  source text default 'landing',
  created_at timestamp with time zone default now()
);

alter table public.documents
  alter column user_id drop not null;

alter table public.documents add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.documents add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.documents add column if not exists has_rect boolean default false;
alter table public.documents add column if not exists preferred_language varchar(8);
alter table public.documents add column if not exists completion_count integer default 0;
alter table public.documents add column if not exists processing_status text default 'idle';
alter table public.documents add column if not exists lifecycle_status text default 'uploaded';
alter table public.documents add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.documents add column if not exists phase1_data jsonb default '{}'::jsonb;
alter table public.documents add column if not exists is_multi_party boolean default false;
alter table public.documents add column if not exists document_type text default 'unknown';

-- Normalize legacy status constraint to include enterprise lifecycle-compatible values
alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents
  add constraint documents_status_check
  check (
    status is null
    or status in ('uploaded', 'processing', 'in_progress', 'ready', 'completed', 'error')
  );

-- Index for fast lookups
create index if not exists idx_documents_user_id on public.documents(user_id);
create index if not exists idx_documents_org_id on public.documents(org_id);
create index if not exists idx_documents_created_at on public.documents(created_at desc);

-- 3. FIELDS TABLE
create table if not exists public.fields (
  id bigserial primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  field_name text not null,
  field_type text default 'text',
  translation text,
  vietnamese_translation text,
  spanish_translation text,
  field_name_vi text,
  field_name_es text,
  explanation text,
  explanation_vi text,
  explanation_en text,
  explanation_es text,
  position_hint text,
  position_hint_vi text,
  position_hint_es text,
  position jsonb,
  sort_order bigint not null,
  field_value text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_fields_document_id on public.fields(document_id);

-- 4. FILL SESSIONS + SESSION FIELDS
create table if not exists public.fill_sessions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  client_user_id uuid references auth.users(id) on delete set null,
  token text,
  token_hash text not null unique,
  recipient_email text,
  recipient_name text,
  recipient_last_name text,
  status text default 'pending',
  assigned_role text,
  field_filter jsonb,
  require_signature boolean default false,
  preferred_language varchar(8),
  send_method text default 'email',
  embed_origin text,
  first_opened_at timestamp with time zone,
  sent_at timestamp with time zone,
  completed_at timestamp with time zone,
  expires_at timestamp with time zone,
  verification_token_hash text,
  verified_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  -- set by the fill_sessions_updated_at trigger (migration 20260313000000)
  updated_at timestamp with time zone default now()
);

alter table public.fill_sessions add column if not exists token text;
alter table public.fill_sessions add column if not exists recipient_last_name text;
alter table public.fill_sessions add column if not exists verification_token_hash text;
alter table public.fill_sessions add column if not exists verified_at timestamp with time zone;

create index if not exists idx_fill_sessions_document_id on public.fill_sessions(document_id);
create index if not exists idx_fill_sessions_status on public.fill_sessions(status);

create table if not exists public.session_fields (
  id bigserial primary key,
  session_id uuid not null references public.fill_sessions(id) on delete cascade,
  field_id bigint not null references public.fields(id) on delete cascade,
  field_value text,
  signature_data_url text,
  signature_timestamp timestamp with time zone,
  filled_at timestamp with time zone,
  updated_at timestamp with time zone default now(),
  unique (session_id, field_id)
);

-- 5. AUDIT LOG
create table if not exists public.audit_log (
  id bigserial primary key,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  actor_type text not null,
  actor_id uuid,
  session_id uuid,
  document_id uuid,
  details jsonb default '{}'::jsonb,
  ip_address text,
  user_agent text,
  timestamp timestamp with time zone default now()
);

create index if not exists idx_audit_document_id on public.audit_log(document_id);
create index if not exists idx_audit_session_id on public.audit_log(session_id);

-- 5b. CHAT HISTORY (lib/supabaseClient.js saveChatMessage / getChatHistory;
-- the RLS migrations of 2026-06-12 and 2026-07-28 set its policies)
create table if not exists public.chat_history (
  id bigserial primary key,
  user_id text, -- the auth uid as text, like documents.user_id
  document_id uuid references public.documents(id) on delete cascade,
  message text,
  response text,
  timestamp timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

create index if not exists idx_chat_history_document_id on public.chat_history(document_id);

-- 6. ROW LEVEL SECURITY
alter table public.documents enable row level security;
alter table public.fields enable row level security;
alter table public.fill_sessions enable row level security;
alter table public.session_fields enable row level security;
alter table public.audit_log enable row level security;
alter table public.organizations enable row level security;
alter table public.org_memberships enable row level security;
alter table public.chat_history enable row level security;

drop policy if exists "Users can view their own documents" on public.documents;
drop policy if exists "Users can insert their own documents" on public.documents;
drop policy if exists "Users can update their own documents" on public.documents;
drop policy if exists "Users can delete their own documents" on public.documents;

create policy "Org members can view documents"
  on public.documents for select
  using (
    exists (
      select 1 from public.org_memberships m
      where m.org_id = documents.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can insert documents"
  on public.documents for insert
  with check (
    exists (
      select 1 from public.org_memberships m
      where m.org_id = documents.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can update documents"
  on public.documents for update
  using (
    exists (
      select 1 from public.org_memberships m
      where m.org_id = documents.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can delete documents"
  on public.documents for delete
  using (
    exists (
      select 1 from public.org_memberships m
      where m.org_id = documents.org_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can view fields"
  on public.fields for select
  using (
    exists (
      select 1 from public.documents d
      join public.org_memberships m on m.org_id = d.org_id
      where d.id = fields.document_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can insert fields"
  on public.fields for insert
  with check (
    exists (
      select 1 from public.documents d
      join public.org_memberships m on m.org_id = d.org_id
      where d.id = fields.document_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can update fields"
  on public.fields for update
  using (
    exists (
      select 1 from public.documents d
      join public.org_memberships m on m.org_id = d.org_id
      where d.id = fields.document_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can view fill sessions"
  on public.fill_sessions for select
  using (
    exists (
      select 1 from public.documents d
      join public.org_memberships m on m.org_id = d.org_id
      where d.id = fill_sessions.document_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can insert fill sessions"
  on public.fill_sessions for insert
  with check (
    exists (
      select 1 from public.documents d
      join public.org_memberships m on m.org_id = d.org_id
      where d.id = fill_sessions.document_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can update fill sessions"
  on public.fill_sessions for update
  using (
    exists (
      select 1 from public.documents d
      join public.org_memberships m on m.org_id = d.org_id
      where d.id = fill_sessions.document_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can view session fields"
  on public.session_fields for select
  using (
    exists (
      select 1 from public.fill_sessions s
      join public.documents d on d.id = s.document_id
      join public.org_memberships m on m.org_id = d.org_id
      where s.id = session_fields.session_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can insert session fields"
  on public.session_fields for insert
  with check (
    exists (
      select 1 from public.fill_sessions s
      join public.documents d on d.id = s.document_id
      join public.org_memberships m on m.org_id = d.org_id
      where s.id = session_fields.session_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can update session fields"
  on public.session_fields for update
  using (
    exists (
      select 1 from public.fill_sessions s
      join public.documents d on d.id = s.document_id
      join public.org_memberships m on m.org_id = d.org_id
      where s.id = session_fields.session_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can view audit log"
  on public.audit_log for select
  using (
    exists (
      select 1 from public.documents d
      join public.org_memberships m on m.org_id = d.org_id
      where d.id = audit_log.document_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can insert audit log"
  on public.audit_log for insert
  with check (true);

create policy "Users can view their orgs"
  on public.organizations for select
  using (
    exists (
      select 1 from public.org_memberships m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
    )
  );

create policy "Users can view their memberships"
  on public.org_memberships for select
  using (auth.uid() = user_id);

-- 7. UPDATED_AT trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger documents_updated_at
  before update on public.documents
  for each row execute procedure public.handle_updated_at();

-- Increment completion count RPC
create or replace function public.increment_completion_count(doc_id uuid)
returns void as $$
begin
  update public.documents
  set completion_count = coalesce(completion_count, 0) + 1
  where id = doc_id;
end;
$$ language plpgsql;

-- =====================================================
-- STORAGE BUCKET SETUP
-- Run these in Supabase Dashboard > Storage
-- OR via the SQL editor below
-- =====================================================

-- Create storage bucket (run in SQL editor)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,  -- private bucket
  52428800,  -- 50MB limit
  array['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']
)
on conflict (id) do nothing;

-- Storage RLS policies
create policy "Users can upload to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read their own files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Org members can upload to org folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and exists (
      select 1 from public.org_memberships m
      where m.org_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can read org files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.org_memberships m
      where m.org_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Org members can delete org files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.org_memberships m
      where m.org_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Filled documents bucket (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'filled-documents',
  'filled-documents',
  false,
  52428800,
  array['application/pdf']
)
on conflict (id) do nothing;

create policy "Org members can read filled documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'filled-documents'
    and exists (
      select 1
      from public.documents d
      join public.org_memberships m on m.org_id = d.org_id
      where d.id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- No other policy on filled-documents: the server writes filled PDFs with the
-- service role, which bypasses row-level security. A policy here without a TO
-- role would apply to every role, anonymous visitors included.

-- =====================================================
-- GOOGLE AUTH SETUP (in Supabase Dashboard)
-- =====================================================
-- 1. Go to Authentication > Providers > Google
-- 2. Enable Google provider
-- 3. Add your Google OAuth Client ID and Secret
-- 4. Add redirect URL: https://your-project.supabase.co/auth/v1/callback
-- 5. In Google Console, add authorized redirect URI:
--    https://your-project.supabase.co/auth/v1/callback
-- =====================================================

-- =====================================================
-- VERCEL ENVIRONMENT VARIABLES
-- =====================================================
-- Set these in Vercel Dashboard > Project > Settings > Environment Variables:
--
-- NEXT_PUBLIC_SUPABASE_URL       = https://xxxx.supabase.co
-- NEXT_PUBLIC_SUPABASE_ANON_KEY  = eyJ...
-- NEXT_PUBLIC_APP_URL            = https://your-app.vercel.app
-- =====================================================
