-- PRD §7: the "Users can ..." policies used USING/CHECK (true), granting any
-- authenticated session (and the public anon key) read/write to EVERY org's
-- documents, fields, and chat. Replace them with owner-scoped policies; the
-- org-member policies already present provide enterprise access. All
-- server-side writes use the service role, which bypasses RLS entirely.

drop policy if exists "Users can view own documents" on public.documents;
drop policy if exists "Users can update own documents" on public.documents;
drop policy if exists "Users can delete own documents" on public.documents;
drop policy if exists "Users can insert documents" on public.documents;

create policy "Owner can view documents" on public.documents for select
  using (user_id = auth.uid()::text or created_by = auth.uid());
create policy "Owner can update documents" on public.documents for update
  using (user_id = auth.uid()::text or created_by = auth.uid());
create policy "Owner can delete documents" on public.documents for delete
  using (user_id = auth.uid()::text or created_by = auth.uid());
create policy "Owner can insert documents" on public.documents for insert
  with check (user_id = auth.uid()::text or created_by = auth.uid());

drop policy if exists "Users can view fields" on public.fields;
drop policy if exists "Users can update fields" on public.fields;
drop policy if exists "Users can insert fields" on public.fields;

create policy "Owner can view fields" on public.fields for select
  using (exists (select 1 from public.documents d
                 where d.id = fields.document_id
                   and (d.user_id = auth.uid()::text or d.created_by = auth.uid())));
create policy "Owner can update fields" on public.fields for update
  using (exists (select 1 from public.documents d
                 where d.id = fields.document_id
                   and (d.user_id = auth.uid()::text or d.created_by = auth.uid())));
create policy "Owner can insert fields" on public.fields for insert
  with check (exists (select 1 from public.documents d
                      where d.id = fields.document_id
                        and (d.user_id = auth.uid()::text or d.created_by = auth.uid())));

drop policy if exists "Users can view own chat history" on public.chat_history;
drop policy if exists "Users can insert chat messages" on public.chat_history;

create policy "Owner can view chat history" on public.chat_history for select
  using (user_id = auth.uid()::text);
create policy "Org members can view chat history" on public.chat_history for select
  using (exists (select 1 from public.documents d
                 join public.org_memberships m on m.org_id = d.org_id
                 where d.id = chat_history.document_id
                   and m.user_id = auth.uid() and m.status = 'active'));

drop policy if exists "Org members can insert audit log" on public.audit_log;
drop policy if exists "Service can insert logs" on public.audit_log;
