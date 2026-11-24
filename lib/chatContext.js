/**
 * Grounding context for "Chat with Cô".
 *
 * Builds a compact summary of the document and its detected fields straight
 * from the database. This replaces the former OpenAI-embeddings retrieval
 * (match_documents), which required an OPENAI_API_KEY and a populated vector
 * store; the chat completion itself runs on Anthropic Claude.
 */

const MAX_FIELDS = 300;
const MAX_VALUE_CHARS = 80;
const MAX_EXPLANATION_CHARS = 120;

/**
 * @param {object} supabase - service-role Supabase client
 * @param {string} documentId
 * @param {object} [options]
 * @param {Array<string|number>} [options.fieldIds] - only these fields (a
 *   signing session's field filter); every field when omitted
 * @param {string} [options.focusFieldId] - the field the signer asked about;
 *   described in its own chunk when it is one of the document's fields
 * @returns {Promise<string[]>} context chunks for chatWithCo (empty on failure)
 */
export async function buildDocumentChatContext(supabase, documentId, options = {}) {
  const { fieldIds, focusFieldId } = options || {};
  if (!documentId) return [];

  const { data: doc } = await supabase
    .from('documents')
    .select('file_name, document_type')
    .eq('id', documentId)
    .single();

  if (!doc) return [];

  const { data: fields } = await supabase
    .from('fields')
    .select('id, field_name, field_type, field_value, explanation')
    .eq('document_id', documentId)
    .order('sort_order', { ascending: true })
    .limit(MAX_FIELDS);

  const docType = doc.document_type && doc.document_type !== 'unknown'
    ? ` (type: ${doc.document_type})`
    : '';

  const allowed = Array.isArray(fieldIds) ? new Set(fieldIds.map(String)) : null;
  const visibleFields = (fields || []).filter(
    (field) => !allowed || allowed.has(String(field.id))
  );

  const lines = visibleFields.map((field) => {
    const value = field.field_value
      ? `value: "${String(field.field_value).slice(0, MAX_VALUE_CHARS)}"`
      : 'empty';
    const note = field.explanation
      ? ` — ${String(field.explanation).slice(0, MAX_EXPLANATION_CHARS)}`
      : '';
    return `- ${field.field_name} (${field.field_type || 'text'}, ${value})${note}`;
  });

  const header = `Document: ${doc.file_name}${docType}`;
  const focusField = focusFieldId === undefined || focusFieldId === null
    ? null
    : visibleFields.find((field) => String(field.id) === String(focusFieldId));
  const focusChunks = focusField
    ? [
      'The user is asking about a specific field. Focused-field context:\n'
        + `Field: ${focusField.field_name} (${focusField.field_type || 'text'})`
        + (focusField.explanation
          ? `\nExplanation: ${String(focusField.explanation).slice(0, MAX_EXPLANATION_CHARS)}`
          : ''),
    ]
    : [];
  if (lines.length === 0) return [...focusChunks, header];

  return [...focusChunks, `${header}\nForm fields (${lines.length}):\n${lines.join('\n')}`];
}
