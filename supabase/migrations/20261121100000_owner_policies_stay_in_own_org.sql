-- Keep a user's own writes inside organisations they belong to.
--
-- The owner policies check only that a row names the user, never which
-- organisation it lands in, so any signed-in user could write into another
-- organisation whose ids they know (the access check's cases
-- authenticated:insert:public.documents, authenticated:insert:public.fill_sessions,
-- authenticated:update:public.documents:move-org_id and
-- authenticated:update:public.fill_sessions:move-document_id):
--
-- - "Owner can insert documents" (20260612120000, as rewritten in
--   20260728180000) let them file a document under that organisation's
--   org_id, and "Owner can update documents" (no WITH CHECK, so its USING
--   decides) let them move their own document there. It then shows in that
--   organisation's lists.
-- - "Clients can create sessions" (20260313000000, as rewritten in
--   20260728180000) let them create a fill session, with a token hash of their
--   own choosing, on any document, and "Clients can update own sessions" let
--   them repoint their own session at one. /api/sessions/<token> then serves
--   that document's name and fields to whoever holds the token.
--
-- Each policy keeps what it allowed and now also requires: for a document,
-- no org_id or an org the user is an active member of; for a fill session, a
-- document the user owns or whose org they are an active member of. The org
-- member policies are unchanged. An owner who has left an organisation can no
-- longer write to the documents they left in it.

ALTER POLICY "Owner can insert documents" ON public.documents
  WITH CHECK (
    ((user_id = ((select auth.uid()))::text) OR (created_by = (select auth.uid())))
    AND (
      org_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_memberships m
        WHERE m.org_id = documents.org_id
          AND m.user_id = (select auth.uid())
          AND m.status = 'active'
      )
    )
  );

ALTER POLICY "Owner can update documents" ON public.documents
  WITH CHECK (
    ((user_id = ((select auth.uid()))::text) OR (created_by = (select auth.uid())))
    AND (
      org_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_memberships m
        WHERE m.org_id = documents.org_id
          AND m.user_id = (select auth.uid())
          AND m.status = 'active'
      )
    )
  );

ALTER POLICY "Clients can create sessions" ON public.fill_sessions
  WITH CHECK (
    ((select auth.uid()) = client_user_id)
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = fill_sessions.document_id
        AND (
          d.user_id = ((select auth.uid()))::text
          OR d.created_by = (select auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.org_memberships m
            WHERE m.org_id = d.org_id
              AND m.user_id = (select auth.uid())
              AND m.status = 'active'
          )
        )
    )
  );

ALTER POLICY "Clients can update own sessions" ON public.fill_sessions
  WITH CHECK (
    ((select auth.uid()) = client_user_id)
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = fill_sessions.document_id
        AND (
          d.user_id = ((select auth.uid()))::text
          OR d.created_by = (select auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.org_memberships m
            WHERE m.org_id = d.org_id
              AND m.user_id = (select auth.uid())
              AND m.status = 'active'
          )
        )
    )
  );
