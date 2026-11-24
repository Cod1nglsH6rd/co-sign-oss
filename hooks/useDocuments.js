/**
 * useDocuments Hook
 * Fetches and manages user documents from Supabase
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

export function useDocuments(userId, orgId, options = {}) {
  const { includeArchived = false } = options;
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDocuments = useCallback(async () => {
    if (!userId || !orgId) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('documents')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });

      if (!includeArchived) {
        query = query.is('archived_at', null);
      }

      const { data, error } = await query;

      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError(err.message);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [userId, orgId, includeArchived]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const deleteDocument = async (documentId, storagePath) => {
    try {
      // Delete the row FIRST: if the row delete fails the file must survive
      // (a row without its file is a permanently broken document; an orphaned
      // file after a failed storage delete is merely invisible waste).
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', documentId);

      if (dbError) throw dbError;

      if (storagePath) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove([storagePath]);
        if (storageError) console.warn('Storage delete error:', storageError);
      }

      // Update local state
      setDocuments(prev => prev.filter(doc => doc.id !== documentId));
      return { success: true };
    } catch (err) {
      console.error('Error deleting document:', err);
      return { success: false, error: err.message };
    }
  };

  const deleteDocuments = async (documentIds) => {
    try {
      // Get documents to find their storage paths
      const docsToDelete = documents.filter(doc => documentIds.includes(doc.id));

      // Rows first, then storage — same rationale as deleteDocument.
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .in('id', documentIds);

      if (dbError) throw dbError;

      const pathsToDelete = docsToDelete
        .map(doc => doc.file_path)
        .filter(Boolean);

      if (pathsToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove(pathsToDelete);
        if (storageError) console.warn('Storage delete error:', storageError);
      }

      // Update local state
      setDocuments(prev => prev.filter(doc => !documentIds.includes(doc.id)));
      return { success: true };
    } catch (err) {
      console.error('Error deleting documents:', err);
      return { success: false, error: err.message };
    }
  };

  const uploadDocument = async (file, userId, preferredLanguage = null) => {
    try {
      if (!orgId) throw new Error('Organization is required');
      const timestamp = Date.now();
      // file_type must be a real extension (compared against 'pdf' by the OCR
      // pipeline) — an extensionless name would otherwise store the whole name.
      const nameParts = file.name.split('.');
      const fileExt = nameParts.length > 1 ? nameParts.pop().toLowerCase() : (
        file.type === 'application/pdf' ? 'pdf' : (file.type || '').split('/')[1] || 'bin'
      );
      // Storage keys must be safe: Vietnamese/Chinese names, spaces, '#'/'?'
      // all break URL handling. Keep a readable ASCII slug + the extension.
      const baseName = (nameParts.length > 1 ? nameParts.join('.') : file.name)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'document';
      const storagePath = `${orgId}/${timestamp}-${baseName}.${fileExt}`;

      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get the public URL (or signed URL for private buckets)
      const { data: { publicUrl } } = supabase.storage
        .from('documents')
        .getPublicUrl(storagePath);

      // Create document record in database
      const { data: docData, error: dbError } = await supabase
        .from('documents')
        .insert([{
          org_id: orgId,
          user_id: userId,
          created_by: userId,
          file_name: file.name,
          file_path: storagePath,
          file_url: publicUrl,
          file_size: file.size,
          file_type: fileExt,
          status: 'uploaded',
          preferred_language: preferredLanguage,
        }])
        .select()
        .single();

      if (dbError) {
        // The row wasn't created — remove the just-uploaded file so it isn't orphaned.
        await supabase.storage.from('documents').remove([storagePath]).catch(() => {});
        throw dbError;
      }

      // Add to local state
      setDocuments(prev => [docData, ...prev]);

      // OCR runs on the document page via its auto-trigger effect once
      // `status === 'uploaded'` is observed. Don't block here.

      return { success: true, document: docData };
    } catch (err) {
      console.error('Error uploading document:', err);
      return { success: false, error: err.message };
    }
  };

  // Helper: call the archive/restore API endpoints with the current
  // Supabase session JWT so the server can verify org ownership.
  const callDocumentAction = async (documentId, action) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const res = await fetch(`/api/documents/${documentId}/${action}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      // ignore parse errors
    }

    if (!res.ok) {
      return { success: false, error: body?.error || `Request failed (${res.status})` };
    }
    return { success: true, document: body?.document || null };
  };

  const archiveDocument = async (documentId) => {
    try {
      const result = await callDocumentAction(documentId, 'archive');
      if (!result.success) return result;

      // If we're filtering archived docs out, drop it from local state.
      // Otherwise merge the updated record back in.
      if (!includeArchived) {
        setDocuments(prev => prev.filter(doc => doc.id !== documentId));
      } else if (result.document) {
        setDocuments(prev => prev.map(doc => (doc.id === documentId ? { ...doc, ...result.document } : doc)));
      }
      return { success: true };
    } catch (err) {
      console.error('Error archiving document:', err);
      return { success: false, error: err.message };
    }
  };

  const restoreDocument = async (documentId) => {
    try {
      const result = await callDocumentAction(documentId, 'restore');
      if (!result.success) return result;

      if (result.document) {
        setDocuments(prev => prev.map(doc => (doc.id === documentId ? { ...doc, ...result.document } : doc)));
      }
      // If we're hiding archived docs, refetch so the restored doc reappears.
      if (!includeArchived) {
        fetchDocuments();
      }
      return { success: true };
    } catch (err) {
      console.error('Error restoring document:', err);
      return { success: false, error: err.message };
    }
  };

  return {
    documents,
    loading,
    error,
    refetch: fetchDocuments,
    deleteDocument,
    deleteDocuments,
    uploadDocument,
    archiveDocument,
    restoreDocument,
  };
}
