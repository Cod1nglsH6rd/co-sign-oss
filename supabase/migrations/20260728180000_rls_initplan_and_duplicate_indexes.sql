-- =====================================================
-- RLS initplan optimization + duplicate index cleanup
-- =====================================================
-- Advisor `auth_rls_initplan`: policies that call auth.uid() directly
-- re-evaluate it per ROW. Wrapping it as (select auth.uid()) makes Postgres
-- evaluate it once per statement (an InitPlan). Semantics are identical.
-- Statements below were generated from live pg_policies definitions.

ALTER POLICY "Clients view own document logs" ON public.audit_log USING ((document_id IN ( SELECT documents.id FROM documents WHERE (documents.user_id = ((select auth.uid()))::text))));
ALTER POLICY "Org members can view audit log" ON public.audit_log USING ((EXISTS ( SELECT 1 FROM (documents d JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((d.id = audit_log.document_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can view chat history" ON public.chat_history USING ((EXISTS ( SELECT 1 FROM (documents d JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((d.id = chat_history.document_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Owner can view chat history" ON public.chat_history USING ((user_id = ((select auth.uid()))::text));
ALTER POLICY "Org members can delete documents" ON public.documents USING ((EXISTS ( SELECT 1 FROM org_memberships m WHERE ((m.org_id = documents.org_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can insert documents" ON public.documents WITH CHECK ((EXISTS ( SELECT 1 FROM org_memberships m WHERE ((m.org_id = documents.org_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can update documents" ON public.documents USING ((EXISTS ( SELECT 1 FROM org_memberships m WHERE ((m.org_id = documents.org_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can view documents" ON public.documents USING ((EXISTS ( SELECT 1 FROM org_memberships m WHERE ((m.org_id = documents.org_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Owner can delete documents" ON public.documents USING (((user_id = ((select auth.uid()))::text) OR (created_by = (select auth.uid()))));
ALTER POLICY "Owner can insert documents" ON public.documents WITH CHECK (((user_id = ((select auth.uid()))::text) OR (created_by = (select auth.uid()))));
ALTER POLICY "Owner can update documents" ON public.documents USING (((user_id = ((select auth.uid()))::text) OR (created_by = (select auth.uid()))));
ALTER POLICY "Owner can view documents" ON public.documents USING (((user_id = ((select auth.uid()))::text) OR (created_by = (select auth.uid()))));
ALTER POLICY "Org members can insert fields" ON public.fields WITH CHECK ((EXISTS ( SELECT 1 FROM (documents d JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((d.id = fields.document_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can update fields" ON public.fields USING ((EXISTS ( SELECT 1 FROM (documents d JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((d.id = fields.document_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can view fields" ON public.fields USING ((EXISTS ( SELECT 1 FROM (documents d JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((d.id = fields.document_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Owner can insert fields" ON public.fields WITH CHECK ((EXISTS ( SELECT 1 FROM documents d WHERE ((d.id = fields.document_id) AND ((d.user_id = ((select auth.uid()))::text) OR (d.created_by = (select auth.uid())))))));
ALTER POLICY "Owner can update fields" ON public.fields USING ((EXISTS ( SELECT 1 FROM documents d WHERE ((d.id = fields.document_id) AND ((d.user_id = ((select auth.uid()))::text) OR (d.created_by = (select auth.uid())))))));
ALTER POLICY "Owner can view fields" ON public.fields USING ((EXISTS ( SELECT 1 FROM documents d WHERE ((d.id = fields.document_id) AND ((d.user_id = ((select auth.uid()))::text) OR (d.created_by = (select auth.uid())))))));
ALTER POLICY "Clients can create sessions" ON public.fill_sessions WITH CHECK (((select auth.uid()) = client_user_id));
ALTER POLICY "Clients can delete own sessions" ON public.fill_sessions USING (((select auth.uid()) = client_user_id));
ALTER POLICY "Clients can update own sessions" ON public.fill_sessions USING (((select auth.uid()) = client_user_id));
ALTER POLICY "Clients can view own sessions" ON public.fill_sessions USING (((select auth.uid()) = client_user_id));
ALTER POLICY "Org members can insert fill sessions" ON public.fill_sessions WITH CHECK ((EXISTS ( SELECT 1 FROM (documents d JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((d.id = fill_sessions.document_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can update fill sessions" ON public.fill_sessions USING ((EXISTS ( SELECT 1 FROM (documents d JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((d.id = fill_sessions.document_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can view fill sessions" ON public.fill_sessions USING ((EXISTS ( SELECT 1 FROM (documents d JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((d.id = fill_sessions.document_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Users can view their memberships" ON public.org_memberships USING (((select auth.uid()) = user_id));
ALTER POLICY "Users can view their orgs" ON public.organizations USING ((EXISTS ( SELECT 1 FROM org_memberships m WHERE ((m.org_id = organizations.id) AND (m.user_id = (select auth.uid()))))));
ALTER POLICY "Org members can insert session fields" ON public.session_fields WITH CHECK ((EXISTS ( SELECT 1 FROM ((fill_sessions s JOIN documents d ON ((d.id = s.document_id))) JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((s.id = session_fields.session_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can update session fields" ON public.session_fields USING ((EXISTS ( SELECT 1 FROM ((fill_sessions s JOIN documents d ON ((d.id = s.document_id))) JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((s.id = session_fields.session_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));
ALTER POLICY "Org members can view session fields" ON public.session_fields USING ((EXISTS ( SELECT 1 FROM ((fill_sessions s JOIN documents d ON ((d.id = s.document_id))) JOIN org_memberships m ON ((m.org_id = d.org_id))) WHERE ((s.id = session_fields.session_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));

-- Advisor `duplicate_index`: keep one of each identical pair.
DROP INDEX IF EXISTS public.idx_audit_document_id;   -- duplicate of idx_audit_log_document
DROP INDEX IF EXISTS public.idx_audit_session_id;    -- duplicate of idx_audit_log_session
DROP INDEX IF EXISTS public.idx_fill_sessions_document; -- duplicate of idx_fill_sessions_document_id
