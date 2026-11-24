import { supabase } from './supabaseClient';

const DEFAULT_TTL_SECONDS = 15 * 60;
const DEFAULT_SIGNED_URL_TIMEOUT_MS = 8 * 1000;

function withTimeout(promise, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`SIGNED_URL_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export async function resolveEnterpriseDocumentUrl({
  filePath,
  fallbackUrl = null,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  timeoutMs = DEFAULT_SIGNED_URL_TIMEOUT_MS,
}) {
  if (!filePath) return fallbackUrl || null;

  try {
    const { data, error } = await withTimeout(
      supabase.storage
        .from('documents')
        .createSignedUrl(filePath, ttlSeconds),
      timeoutMs
    );

    if (error) {
      console.warn('Failed to create signed URL for document:', error.message);
      return fallbackUrl || null;
    }

    return data?.signedUrl || fallbackUrl || null;
  } catch (err) {
    if ((err?.message || '').startsWith('SIGNED_URL_TIMEOUT:')) {
      console.warn(`Signed URL refresh timed out after ${timeoutMs}ms`);
    } else {
      console.warn('Signed URL refresh exception:', err?.message || err);
    }
    return fallbackUrl || null;
  }
}
