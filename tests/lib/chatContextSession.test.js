/**
 * buildDocumentChatContext options used by the signer chat: the session's
 * field filter limits which fields are described, and the field the signer
 * asked about gets its own chunk, looked up in the document (never taken
 * from text the client sends).
 */
import { buildDocumentChatContext } from '../../lib/chatContext';

function fakeSupabase({ doc, fields }) {
  return {
    from: (table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: table === 'fields' ? fields : null }),
        single: () => Promise.resolve({ data: table === 'documents' ? doc : null }),
      };
      return builder;
    },
  };
}

const supabase = fakeSupabase({
  doc: { file_name: 'w9.pdf', document_type: 'w9' },
  fields: [
    { id: 'f-1', field_name: 'Name', field_type: 'text', field_value: null, explanation: 'Your legal name' },
    { id: 'f-2', field_name: 'SSN', field_type: 'text', field_value: '000-00-0000', explanation: 'Tax id' },
  ],
});

describe('buildDocumentChatContext options', () => {
  it('describes every field without options (unchanged for the owner chat)', async () => {
    const chunks = await buildDocumentChatContext(supabase, 'doc-1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('- Name (text, empty)');
    expect(chunks[0]).toContain('- SSN (text, value: "000-00-0000")');
  });

  it('describes only the fields in the session field filter', async () => {
    const chunks = await buildDocumentChatContext(supabase, 'doc-1', { fieldIds: ['f-1'] });
    expect(chunks.join('\n')).toContain('- Name (text, empty)');
    expect(chunks.join('\n')).not.toContain('SSN');
  });

  it('adds the focused field from the document', async () => {
    const chunks = await buildDocumentChatContext(supabase, 'doc-1', { focusFieldId: 'f-1' });
    expect(chunks[0]).toContain('Field: Name (text)');
    expect(chunks[0]).toContain('Explanation: Your legal name');
  });

  it('ignores a focused field that is not visible to the session', async () => {
    const chunks = await buildDocumentChatContext(supabase, 'doc-1', { fieldIds: ['f-1'], focusFieldId: 'f-2' });
    expect(chunks).toHaveLength(1);
    expect(chunks.join('\n')).not.toContain('SSN');
  });
});
