import { supabase } from './supabaseClient';
import { prepareImageUpload, browserImageDeps } from './uprightImage';

const EXT_BY_TYPE = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

// A phone photo is turned upright (and shrunk) before upload; a PDF or PNG is
// uploaded as picked; a HEIC is refused with a message.
async function prepareFile(file) {
  const input = {
    bytes: new Uint8Array(await file.arrayBuffer()),
    type: file.type,
    name: file.name,
  };
  const prepared = await prepareImageUpload(input, browserImageDeps());
  if (prepared === input) return file;
  return new Blob([prepared.bytes], { type: prepared.type });
}

export async function uploadEnterpriseDocument({
  file,
  fileName,
  orgId,
  userId,
  addAsTemplate = false,
  accessToken,
}) {
  if (!file || !userId) throw new Error('Missing file or user');

  const upload = await prepareFile(file);
  const timestamp = Date.now();
  const fileExt = EXT_BY_TYPE[String(upload.type || '').toLowerCase()] || file.name.split('.').pop();
  const storagePrefix = orgId || userId;
  const storagePath = `${storagePrefix}/${timestamp}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, upload, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: signed, error: signedError } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, 15 * 60);
  if (signedError) throw signedError;

  const metadata = addAsTemplate
    ? { templateStatus: 'active', templateSource: 'upload' }
    : {};

  const { data: docData, error: dbError } = await supabase
    .from('documents')
    .insert([{
      org_id: orgId || null,
      user_id: userId,
      created_by: userId,
      file_name: fileName || file.name,
      file_path: storagePath,
      file_url: signed?.signedUrl || null,
      file_size: upload.size,
      file_type: fileExt,
      status: 'uploaded',
      processing_status: 'prepping',
      lifecycle_status: 'uploaded',
      preferred_language: null,
      metadata,
    }])
    .select('id, file_name, file_path, file_size, status, processing_status, lifecycle_status, preferred_language, created_at, created_by, phase1_data')
    .single();

  if (dbError) throw dbError;

  // Kick off pre-setup OCR (async)
  fetch('/api/ocr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      documentId: docData.id,
      userId,
      preferredLanguage: docData.preferred_language || 'en',
      mode: 'pre_setup',
    }),
  }).catch((err) => {
    console.warn('Auto OCR (pre-setup) failed:', err.message || err);
  });

  return docData;
}
