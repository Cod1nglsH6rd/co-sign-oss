/**
 * Storage paths the server signs or copies with the service role.
 *
 * Rows that organisation members can edit (documents.file_path,
 * fill_sessions.metadata) must not decide which object the service role
 * reaches: a member who learned another organisation's object path could
 * otherwise get a signed URL or a copy of it.
 *
 * - documents bucket: uploads are stored under the owning organisation's
 *   folder, `<org_id>/<file>` (hooks/useDocuments.js, lib/enterpriseUpload.js,
 *   pages/api/enterprise/templates/duplicate.js); the owner and member
 *   policies only let a writer set an org_id they are an active member of.
 *   A document with no organisation was uploaded under its uploader's folder,
 *   `<user_id>/<file>` (lib/enterpriseUpload.js writes user_id and created_by
 *   both as the uploader). user_id is text the writer chooses: "Owner can
 *   insert/update documents" pass when user_id = auth.uid()::text OR
 *   created_by = auth.uid(), so a row with created_by = the writer can carry
 *   any user_id, another organisation's id included. The folder is accepted
 *   only when created_by is null (the policy then forces user_id to be the
 *   writer) or equal to user_id (one of them is the writer).
 * - filled-documents bucket: a filled PDF is always
 *   `<document id>/<session id>-filled.pdf`
 *   (pages/api/sessions/[token]/complete.js), so it is recomputed from the
 *   ids, never read from metadata.
 */
import { DocumentSourceNotAllowedError } from './documentFetch.js';

// A plain relative object key: no leading slash, no backslash, no empty,
// "." or ".." segment, no control characters.
export function isPlainStoragePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

// The folder a document's file must be in, or null when it has no owner the
// policies vouch for.
export function documentOwnerFolder(document) {
  const { org_id: orgId, user_id: userId, created_by: createdBy } = document || {};
  if (orgId !== null && orgId !== undefined && String(orgId) !== '') return String(orgId);
  if (userId === null || userId === undefined || String(userId) === '') return null;
  if (createdBy === null || createdBy === undefined || String(createdBy) === String(userId)) {
    return String(userId);
  }
  return null;
}

/**
 * True when `filePath` is inside the folder of the document's owner.
 * @param {string} filePath
 * @param {{ org_id?: string|null, user_id?: string|null, created_by?: string|null }} document - the documents row
 */
export function isDocumentPathOwnedBy(filePath, document) {
  const owner = documentOwnerFolder(document);
  if (!owner || !isPlainStoragePath(filePath)) return false;
  const prefix = `${owner}/`;
  return filePath.startsWith(prefix) && filePath.length > prefix.length;
}

/**
 * Before a service-role download of a document's file: throws
 * DocumentSourceNotAllowedError when file_path is set and outside the owner's
 * folder (the route answers 422 document_source_not_allowed). A document with
 * no file_path is fetched from file_url, which documentFetch.js restricts to
 * public addresses.
 * @param {{ id?: string, file_path?: string|null, org_id?: string|null, user_id?: string|null, created_by?: string|null }} document
 */
export function assertDocumentPathOwned(document) {
  if (!document?.file_path) return;
  if (!isDocumentPathOwnedBy(document.file_path, document)) {
    throw new DocumentSourceNotAllowedError(
      'Document file is outside its owner folder',
      { documentId: document.id || null }
    );
  }
}

export function filledPdfPath(documentId, sessionId) {
  return `${documentId}/${sessionId}-filled.pdf`;
}
