/**
 * Anthropic Claude API Client
 * Used for document OCR and field extraction via Claude Vision
 */

import Anthropic from '@anthropic-ai/sdk';
import { effectiveSetting } from './hostSettings';

// Built on first use from the env key, else the key saved at setup, and
// rebuilt when that key changes, so a key saved at setup works without a
// restart.
let client = null;
let clientKey = null;

export function getAnthropicClient() {
  const apiKey = effectiveSetting('ANTHROPIC_API_KEY', process.env);
  if (!client || apiKey !== clientKey) {
    client = new Anthropic({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

// Callers of the default export use anthropic.messages.create(...); each call
// goes to the client for the current key.
const anthropic = {
  messages: {
    create: (...args) => getAnthropicClient().messages.create(...args),
  },
};

/**
 * System prompt for Cô - the AI assistant
 */
export const CO_SYSTEM_PROMPT = `You are "Cô" (meaning "Miss" or "Teacher" in Vietnamese), an AI secretary designed to help Vietnamese-speaking users understand and fill out English-language forms.

Your role:
- Explain form fields clearly in Vietnamese
- Provide step-by-step guidance
- Answer questions about the document
- Be patient, friendly, and encouraging
- Use simple, everyday Vietnamese language
- When unsure, acknowledge limitations and suggest alternatives

Guidelines:
- Always respond in Vietnamese unless explicitly asked to use English
- Break down complex terms into simple explanations
- Provide examples when helpful
- Never make up information - if you don't know, say so
- Respect user privacy and data security`;

/**
 * Extract form fields from a document image using Claude Vision
 * @param {string} base64Image - Base64 encoded image
 * @param {string} mediaType - MIME type (image/png, image/jpeg, application/pdf)
 * @returns {Array} Extracted fields
 */
export async function extractFieldsFromDocument(base64Image, mediaType) {
  const imageMediaType = mediaType === 'application/pdf' ? 'image/png' : mediaType;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMediaType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `You are a document analysis expert. Analyze this document image carefully and extract ALL form fields that a user would need to fill in.

For EACH field, return a JSON object with these properties:
- "field_name": The English label/name of the field as it appears on the form
- "field_type": One of: "text", "date", "email", "tel", "number", "checkbox", "signature", "address", "ssn", "select"
- "field_name_vi": The field name translated to Vietnamese
- "field_name_es": The field name translated to Spanish
- "explanation": A clear, simple English explanation of what the user should enter in this field (2-3 sentences max). Write as if explaining to someone whose first language is not English.

Return ONLY a valid JSON array. No markdown, no code blocks, no extra text. Example format:
[
  {
    "field_name": "Full Legal Name",
    "field_type": "text",
    "field_name_vi": "Họ và tên đầy đủ",
    "field_name_es": "Nombre legal completo",
    "explanation": "Enter your complete legal name exactly as it appears on your government-issued ID. Include first name, middle name (if any), and last name."
  }
]

If the document has no form fields (e.g., it's a letter or article), return an empty array [].
Analyze the ENTIRE document thoroughly. Do not miss any fields.`,
          },
        ],
      },
    ],
  });

  // Parse the response
  const text = response.content[0].text.trim();

  // Try to extract JSON from the response
  let fields;
  try {
    fields = JSON.parse(text);
  } catch {
    // If direct parse fails, try to find JSON array in the text
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      fields = JSON.parse(jsonMatch[0]);
    } else {
      console.error('Failed to parse Claude response:', text);
      throw new Error('Could not parse field extraction response');
    }
  }

  // Validate and normalize
  return fields.map((field, index) => ({
    field_name: field.field_name || `Field ${index + 1}`,
    field_type: field.field_type || 'text',
    field_name_vi: field.field_name_vi || '',
    field_name_es: field.field_name_es || '',
    explanation: field.explanation || '',
    sort_order: index,
  }));
}

/**
 * Chat with Cô about the document, powered by Claude.
 * @param {string} userMessage - User's question
 * @param {string[]} contextChunks - Relevant document chunks
 * @param {Array} chatHistory - Previous chat messages ({role, content})
 */
export async function chatWithCo(userMessage, contextChunks = [], chatHistory = [], language = 'en') {
  const documentContext = contextChunks.length > 0
    ? `\n\nRelevant document content:\n${contextChunks.join('\n\n---\n\n')}`
    : '';

  // Respond in the user's selected language, not a hardcoded default. Cô serves
  // 9 locales — replying in Vietnamese to a Spanish/Chinese/English user (the old
  // behavior) is wrong.
  const CHAT_LANGUAGE_NAMES = {
    en: 'English', vi: 'Vietnamese', es: 'Spanish', pt: 'Portuguese',
    fr: 'French', zh: 'Mandarin Chinese', yue: 'Cantonese',
    ht: 'Haitian Creole', ne: 'Nepali',
  };
  const langName = CHAT_LANGUAGE_NAMES[language] || 'English';
  const systemPrompt = `You are "Cô" (meaning "Miss" or "Teacher" in Vietnamese), a friendly AI assistant that helps people understand and fill out forms.

Your role:
- Explain form fields clearly and answer questions about the document
- Give step-by-step guidance with examples when helpful
- Be patient, warm, and encouraging; use simple, everyday language

Guidelines:
- Respond ONLY in ${langName}. Write your entire reply in ${langName}, no matter what language the form or this prompt is in.
- Break down complex/legal/tax terms into plain language
- Never make up information — if you don't know, say so
- Respect user privacy and data security`;

  // Claude requires the first message to be a user turn; the UI seeds the
  // transcript with an assistant greeting, so drop leading assistant turns.
  let history = chatHistory
    .filter((msg) => msg?.content && (msg.role === 'user' || msg.role === 'assistant'))
    .map((msg) => ({ role: msg.role, content: String(msg.content) }));

  // Cost guard: the full doc context is already resent every turn, so we don't
  // also need to resend the whole transcript. Keep only the most recent N turns
  // — recent context is what matters for form help, and this bounds per-message
  // input tokens no matter how long the conversation runs.
  const MAX_HISTORY = Math.max(2, Number(process.env.CHAT_MAX_HISTORY_TURNS || 16));
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }
  while (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }

  const response = await anthropic.messages.create({
    // PRD §4: chat is high-volume and conversational — Haiku keeps replies
    // fast and inexpensive; accuracy-critical OCR stays on Sonnet above.
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemPrompt + documentContext,
    messages: [
      ...history,
      { role: 'user', content: userMessage },
    ],
  });

  return {
    message: response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(''),
    usage: response.usage,
  };
}

export default anthropic;
