import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../../../lib/auth';
import { isDocumentPathOwnedBy } from '../../../../lib/storagePaths';
/**
 * POST /api/enterprise/templates/duplicate
 *
 * Duplicate a template document (PDF + fields) for enterprise setup.
 * Auth: Supabase JWT (authenticated client)
 * Body: { templateId: string, newName: string }
 */

const sanitizeFileName = (value) => {
  if (!value) return '';
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]+/g, '')
    .slice(0, 140);
};

const ensurePdfExtension = (name, sourceName = '') => {
  const hasExt = /\.[a-zA-Z0-9]{2,6}$/.test(name);
  if (hasExt) return name;
  const sourceExt = sourceName.split('.').pop();
  if (sourceExt && sourceExt.length <= 6) return `${name}.${sourceExt}`;
  return `${name}.pdf`;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = requireServiceSupabase();

    const auth = await requireBearerUser(req, supabase);
    if (auth.error) {
      return res.status(401).json({
        error: auth.error === 'missing_auth' ? 'Missing authorization header' : 'Invalid or expired token',
      });
    }
    const { user } = auth;

    const { templateId, newName } = req.body || {};
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }

    const cleanedName = sanitizeFileName(newName);
    if (!cleanedName) {
      return res.status(400).json({ error: 'newName is required' });
    }

    const { membership, error: membershipError } = await requireOrgMembership(
      user.id,
      supabase,
      requestedOrgId(req)
    );

    if (membershipError) {
      return res.status(403).json({ error: 'User is not a member of any organization' });
    }

    const { data: template, error: templateError } = await supabase
      .from('documents')
      .select('id, file_name, file_path, file_url, file_size, file_type, preferred_language, org_id, phase1_data')
      .eq('id', templateId)
      .eq('org_id', membership.org_id)
      .single();

    if (templateError || !template) {
      return res.status(404).json({ error: 'Template not found or access denied' });
    }

    // file_path is editable by organisation members and the copy below runs
    // with the service role: copy only from the organisation's own folder.
    if (!isDocumentPathOwnedBy(template.file_path, { org_id: membership.org_id })) {
      console.warn('[Templates] Duplicate refused: file path outside the organisation folder', {
        templateId: template.id,
      });
      return res.status(403).json({ error: 'This template file cannot be copied' });
    }

    if (!template?.phase1_data?.setupCompleted) {
      return res.status(400).json({ error: 'Template setup is not complete' });
    }

    const finalName = ensurePdfExtension(cleanedName, template.file_name || '');
    const timestamp = Date.now();
    const storagePrefix = membership.org_id || user.id;
    const storagePath = `${storagePrefix}/${timestamp}-${finalName}`;

    const { error: copyError } = await supabase.storage
      .from('documents')
      .copy(template.file_path, storagePath);

    if (copyError) {
      console.error('[Templates] Storage copy error:', copyError);
      return res.status(500).json({ error: 'Failed to duplicate file' });
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 15 * 60);
    if (signedError) {
      console.error('[Templates] Signed URL error:', signedError);
      await supabase.storage.from('documents').remove([storagePath]);
      return res.status(500).json({ error: 'Failed to sign file URL' });
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('enterprise_duplicate_template_tx', {
      p_template_id: template.id,
      p_org_id: membership.org_id,
      p_user_id: user.id,
      p_new_file_name: finalName,
      p_new_file_path: storagePath,
      p_new_file_url: signed?.signedUrl || null,
    });

    if (rpcError || !rpcData?.documentId) {
      console.error('[Templates] Duplicate RPC error:', rpcError);
      await supabase.storage.from('documents').remove([storagePath]);
      return res.status(500).json({ error: 'Failed to create document copy' });
    }

    return res.status(201).json({
      success: true,
      documentId: rpcData.documentId,
      fileName: rpcData.fileName || finalName,
    });
  } catch (err) {
    console.error('[Templates] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
