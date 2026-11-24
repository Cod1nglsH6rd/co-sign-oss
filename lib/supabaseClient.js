/**
 * Supabase Client Configuration
 * Handles authentication, database operations, and file storage
 */

import { createClient } from '@supabase/supabase-js';
import { serverSupabaseUrl, serviceKey } from './supabaseEnv';
import { authReturnType } from './invitePassword';

// In the browser, the running server's values (window.__COSIGN_PUBLIC__, set by
// /api/runtime-config.js) come before the build-time NEXT_PUBLIC_* ones. A null
// runtime url means the page's own origin, unless the build carries its own url
// (the Vercel/cloud setup), which then still applies.
const runtimePublic = typeof window !== 'undefined' ? window.__COSIGN_PUBLIC__ : null;

// Initialize Supabase client with public credentials
const supabaseUrl = runtimePublic?.supabaseUrl
  || process.env.NEXT_PUBLIC_SUPABASE_URL
  || (runtimePublic ? window.location.origin : 'https://placeholder.supabase.co');
const supabaseAnonKey = runtimePublic?.anonKey
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || 'placeholder-key';

// Note: In demo mode without real credentials, Supabase operations will fail gracefully
const isConfigured = supabaseUrl !== 'https://placeholder.supabase.co';
if (!isConfigured) {
  console.warn('Supabase not configured - running in demo mode');
}

// The return type the auth service put in the URL fragment (type=invite after
// an invite link). The client below uses the implicit flow (the default; no
// flowType is set), so the invite link comes back as #access_token=…&type=…;
// an admin-made link carries no PKCE code. Read here, before createClient:
// with detectSessionInUrl the client takes the session from the fragment and
// clears it, and the auth state event it then sends (SIGNED_IN) does not tell
// an invite from other sign-ins. On the server there is no fragment.
let urlAuthTypeAtLoad = typeof window !== 'undefined' ? authReturnType(window.location.hash) : null;
export function urlAuthType() {
  return urlAuthTypeAtLoad;
}
export function forgetUrlAuthType() {
  urlAuthTypeAtLoad = null;
}

// Public client for client-side operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

/**
 * Server-side service-role client for API routes. Throws when not configured
 * so routes fail fast with one clear message instead of each endpoint
 * reimplementing (and varying) this check.
 */
export function requireServiceSupabase() {
  const url = serverSupabaseUrl();
  const serviceRoleKey = serviceKey();
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase credentials not configured (SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Admin client for server-side operations (use with caution)
export const getServiceSupabase = () => {
  const serviceRoleKey = serviceKey();
  if (!serviceRoleKey) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY not set - admin operations will fail');
    return null;
  }
  return createClient(serverSupabaseUrl() || 'https://placeholder.supabase.co', serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });

  if (error) throw error;
  return data;
}

/**
 * Sign out current user
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get current user session
 */
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

/**
 * Get current user profile
 */
export async function getUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

/**
 * Upload a file to Supabase Storage
 * @param {File} file - The file to upload
 * @param {string} bucket - Storage bucket name (default: 'documents')
 * @param {string} userId - User ID for organizing files
 */
export async function uploadFile(file, bucket = 'documents', userId) {
  if (!userId) {
    throw new Error('User ID is required for file upload');
  }

  const timestamp = Date.now();
  const fileName = `${userId}/${timestamp}-${file.name}`;

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) throw error;

  // Get public URL
  const { data: signed, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(fileName, 15 * 60);
  if (signedError) throw signedError;

  return {
    path: data.path,
    publicUrl: signed?.signedUrl || null,
    fileName,
  };
}

/**
 * Delete a file from Supabase Storage
 * @param {string} filePath - Path to the file in storage
 * @param {string} bucket - Storage bucket name
 */
export async function deleteFile(filePath, bucket = 'documents') {
  const { error } = await supabase.storage
    .from(bucket)
    .remove([filePath]);

  if (error) throw error;
  return true;
}

/**
 * Create a new document record in database
 */
export async function createDocument(userId, fileUrl, fileName) {
  const { data, error } = await supabase
    .from('documents')
    .insert([
      {
        user_id: userId,
        file_url: fileUrl,
        file_name: fileName,
        status: 'uploaded',
        created_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get document by ID
 */
export async function getDocument(documentId, userId) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all documents for a user
 */
export async function getUserDocuments(userId, limit = 50) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Update document status
 */
export async function updateDocumentStatus(documentId, status) {
  const { data, error } = await supabase
    .from('documents')
    .update({ status })
    .eq('id', documentId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Save chat message to history
 */
export async function saveChatMessage(userId, documentId, message, response) {
  const { data, error } = await supabase
    .from('chat_history')
    .insert([
      {
        user_id: userId,
        document_id: documentId,
        message,
        response,
        timestamp: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get chat history for a document
 */
export async function getChatHistory(documentId, limit = 50) {
  const { data, error } = await supabase
    .from('chat_history')
    .select('*')
    .eq('document_id', documentId)
    .order('timestamp', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data;
}

/**
 * Create or update document fields
 */
export async function upsertFields(documentId, fields) {
  const fieldsWithDocId = fields.map((field, index) => ({
    document_id: documentId,
    sort_order: index,
    ...field,
  }));

  const { data, error } = await supabase
    .from('fields')
    .upsert(fieldsWithDocId, { onConflict: 'document_id,sort_order' })
    .select();

  if (error) throw error;
  return data;
}

/**
 * Get fields for a document
 */
export async function getDocumentFields(documentId) {
  const { data, error } = await supabase
    .from('fields')
    .select('*')
    .eq('document_id', documentId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data;
}

export default supabase;
