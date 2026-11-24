/**
 * Which folder a document's storage path must be in (lib/storagePaths.js).
 *
 * - A document with an organisation: `<org_id>/...`. The owner and member
 *   policies only let a writer set an org_id they are an active member of.
 * - A document with no organisation: `<user_id>/...`, and only when
 *   created_by is null or equal to user_id. user_id is text the writer
 *   chooses; "Owner can insert documents" / "Owner can update documents"
 *   pass when user_id = auth.uid()::text OR created_by = auth.uid(). With
 *   created_by null, user_id must be the writer; with both set and equal, one
 *   of them is. Real uploads write both as the uploader.
 */
import { isDocumentPathOwnedBy, filledPdfPath } from '../../lib/storagePaths';

const ORG_A = 'org-aaaa';
const ORG_B = 'org-bbbb';

describe('isDocumentPathOwnedBy(filePath, document row)', () => {
  it('accepts a path in the document organisation folder', () => {
    expect(isDocumentPathOwnedBy(`${ORG_A}/1-lease.pdf`, { org_id: ORG_A, user_id: 'u-1', created_by: 'u-1' })).toBe(true);
  });

  it('refuses a path in another organisation folder', () => {
    expect(isDocumentPathOwnedBy(`${ORG_B}/1-lease.pdf`, { org_id: ORG_A, user_id: 'u-1', created_by: 'u-1' })).toBe(false);
  });

  it('refuses the forged no-organisation row: user_id set to another organisation, created_by the writer', () => {
    expect(isDocumentPathOwnedBy(`${ORG_B}/1-secret.pdf`, { org_id: null, user_id: ORG_B, created_by: 'u-att' })).toBe(false);
  });

  it('refuses the mirrored row: user_id the writer, created_by someone else, path in their folder', () => {
    expect(isDocumentPathOwnedBy('u-other/1-secret.pdf', { org_id: null, user_id: 'u-att', created_by: 'u-other' })).toBe(false);
    expect(isDocumentPathOwnedBy('u-att/1-mine.pdf', { org_id: null, user_id: 'u-att', created_by: 'u-other' })).toBe(false);
  });

  it('accepts a no-organisation upload in its uploader folder (user_id = created_by)', () => {
    expect(isDocumentPathOwnedBy('u-1/1-lease.pdf', { org_id: null, user_id: 'u-1', created_by: 'u-1' })).toBe(true);
  });

  it('accepts a no-organisation row with created_by null in the user_id folder', () => {
    expect(isDocumentPathOwnedBy('u-1/1-lease.pdf', { org_id: null, user_id: 'u-1', created_by: null })).toBe(true);
  });

  it('refuses a row with no owner at all, and paths that are not plain keys', () => {
    expect(isDocumentPathOwnedBy('u-1/x.pdf', { org_id: null, user_id: null, created_by: 'u-1' })).toBe(false);
    for (const p of [`${ORG_A}/../${ORG_B}/x.pdf`, `${ORG_A}/./x.pdf`, `${ORG_A}//x.pdf`, `/${ORG_A}/x.pdf`, `${ORG_A}\\x.pdf`, `${ORG_A}/`, '', null]) {
      expect(isDocumentPathOwnedBy(p, { org_id: ORG_A })).toBe(false);
    }
  });

  it('builds the filled PDF path the way complete.js stores it', () => {
    expect(filledPdfPath('d-1', 's-1')).toBe('d-1/s-1-filled.pdf');
  });
});
