/**
 * POST /api/documents/[id]/translate  { language }
 *
 * Owner-triggered translation of a document's *existing* fields into one
 * additional language. English is generated at OCR time; this adds any other
 * supported language on demand, with no plan limit, and caches it (writes the
 * `field_name_<code>` / `explanation_<code>` / `position_hint_<code>` columns),
 * so it runs at most once per (document, language).
 *
 * Deliberately isolated from /api/ocr (the detection pipeline) so it can serve
 * both personal (full-mode) and enterprise docs without the post_setup gate,
 * and without risk to the tested OCR flow. Recipients never hit this — only the
 * authenticated document owner — which keeps the paid work off public endpoints.
 */

import { z } from 'zod';
import { getServiceSupabase } from '../../../../lib/supabaseClient';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../../../lib/auth';
import { rateLimitAuth } from '../../../../lib/rateLimit';

const SUPPORTED = ['en', 'vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne'];
const LANGUAGE_NAMES = {
  vi: 'Vietnamese', es: 'Spanish', pt: 'Portuguese', fr: 'French',
  zh: 'Simplified Chinese (Mandarin)', yue: 'Cantonese (Traditional Chinese)',
  ht: 'Haitian Creole', ne: 'Nepali',
};
const CHUNK = 10;

const bodySchema = z.object({ language: z.string().min(2).max(8) });

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Recover complete {...} objects even when the array wrapper is slightly
// malformed/truncated (more common on CJK responses) instead of losing all.
const extractJsonObjects = (text) => {
  const objs = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) start = i; depth += 1; }
    else if (c === '}') { depth -= 1; if (depth === 0 && start >= 0) { try { objs.push(JSON.parse(text.slice(start, i + 1))); } catch {} start = -1; } }
  }
  return objs;
};

const parseJsonArray = (text) => {
  const cleaned = String(text || '').replace(/^```json\s*/g, '').replace(/```$/g, '').trim();
  try { const v = JSON.parse(cleaned); if (Array.isArray(v)) return v; } catch {}
  const m = cleaned.match(/\[[\s\S]*\]/);
  if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) return v; } catch {} }
  const objs = extractJsonObjects(cleaned);
  return objs;
};

// Which non-English languages already have content across the doc's fields.
const translatedLanguagesFor = (fields) => {
  const have = new Set();
  for (const code of SUPPORTED) {
    if (code === 'en') continue;
    if ((fields || []).some((f) => f[`field_name_${code}`] && String(f[`field_name_${code}`]).trim())) have.add(code);
  }
  return [...have];
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getServiceSupabase();
  if (!supabase) return res.status(500).json({ error: 'Server not configured' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Translation not configured' });

  const auth = await requireBearerUser(req, supabase);
  if (auth.status) return res.status(auth.status).json({ error: auth.error });
  const mem = await requireOrgMembership(auth.user.id, supabase, requestedOrgId(req));
  if (mem.status) return res.status(mem.status).json({ error: mem.error });

  if (await rateLimitAuth(req, res, 'document-translate', auth.user.id)) return;

  const parsed = bodySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'language is required' });
  const language = parsed.data.language.toLowerCase();
  if (!SUPPORTED.includes(language)) return res.status(400).json({ error: `Unsupported language: ${language}` });

  const { id: documentId } = req.query;

  // Document must belong to the caller's org.
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('id, org_id, preferred_language')
    .eq('id', documentId)
    .eq('org_id', mem.orgId)
    .single();
  if (docErr || !doc) return res.status(404).json({ error: 'Document not found' });

  if (language === 'en') return res.status(200).json({ success: true, status: 'english', language: 'en' });

  const { data: fields, error: fErr } = await supabase
    .from('fields')
    .select('*')
    .eq('document_id', documentId)
    .order('sort_order', { ascending: true });
  if (fErr) return res.status(500).json({ error: 'Failed to load fields' });
  if (!fields || fields.length === 0) return res.status(409).json({ error: 'Document has no fields yet', errorCode: 'not_ready' });

  const currentLanguages = translatedLanguagesFor(fields);

  // Already done — no-op, report success so the UI can just switch to it.
  if (currentLanguages.includes(language)) {
    return res.status(200).json({ success: true, status: 'already', language, languages: currentLanguages });
  }

  // Translate existing fields into `language` (Haiku; chunked; input-order merge
  // so results align with fields even if the model renumbers indices).
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const langName = LANGUAGE_NAMES[language] || language;

    const indexed = fields.map((f, i) => ({
      idx: i,
      id: f.id,
      field_name: f.field_name || '',
      explanation: f.explanation || '',
      position_hint: f.position_hint || '',
    }));

    const updates = new Map(); // field id -> {col: val}
    for (const group of chunk(indexed, CHUNK)) {
      const list = group.map((g, j) => `${j + 1}. name: ${JSON.stringify(g.field_name)} | explanation: ${JSON.stringify(g.explanation)} | hint: ${JSON.stringify(g.position_hint)}`).join('\n');
      const prompt = `Translate these form-field labels into ${langName}. Keep it natural and simple for someone filling a form.

FIELDS (in order):
${list}

Return ONLY a JSON array of exactly ${group.length} objects, in the SAME ORDER, each:
{"field_name": "<${langName}>", "explanation": "<${langName}>", "position_hint": "<${langName}>"}

IMPORTANT — valid JSON only:
- Do NOT use the double-quote character (") inside any value. If you must quote a word/label, use single quotes ('like this').
- Keep each value on a single line (no line breaks inside a value).
- Do not add or drop items. No markdown, no commentary.`;

      let arr = [];
      try {
        const resp = await anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });
        arr = parseJsonArray(resp?.content?.[0]?.text || '');
        if (arr.length === 0) console.warn('[translate] empty parse for', language, '(chunk produced no usable JSON)');
      } catch (e) {
        console.warn('[translate] chunk failed:', e.message);
      }
      // Merge by INPUT ORDER, not any echoed index.
      group.forEach((g, j) => {
        const t = arr[j];
        if (!t) return;
        updates.set(g.id, {
          [`field_name_${language}`]: String(t.field_name || g.field_name || '').slice(0, 500),
          [`explanation_${language}`]: String(t.explanation || '').slice(0, 2000),
          [`position_hint_${language}`]: String(t.position_hint || '').slice(0, 500),
        });
      });
    }

    if (updates.size === 0) {
      return res.status(502).json({ error: 'Translation produced no results', errorCode: 'translation_failed' });
    }

    // Persist per-field.
    let written = 0;
    for (const [fieldId, cols] of updates) {
      const { error } = await supabase.from('fields').update(cols).eq('id', fieldId);
      if (!error) written += 1;
    }

    const languages = [...new Set([...currentLanguages, language])];
    return res.status(200).json({
      success: true,
      status: 'translated',
      language,
      fieldsTranslated: written,
      languages,
    });
  } catch (err) {
    console.error('[translate] error:', err.message);
    return res.status(500).json({ error: 'Translation failed' });
  }
}
