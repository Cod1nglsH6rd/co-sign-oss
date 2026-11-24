/**
 * GET /api/runtime-config.js (served through runtime-config.js.js)
 *
 * A script that hands the browser the database address and public (anon) key
 * the running server has now, so a self-hosted build needs no NEXT_PUBLIC_*
 * values baked in. pages/_document.js loads it with a blocking <script> in
 * <head>. supabaseUrl is PUBLIC_SUPABASE_URL, or null for "same origin as
 * the page". The service key is never read here.
 */

import { anonKey, publicSupabaseUrl } from '../../lib/supabaseEnv';

// <, >, & and the two JS line separators (U+2028, U+2029).
const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

// JSON is valid JS; writing the unsafe characters as \uXXXX escapes keeps a
// crafted value inside its string literal wherever the script ends up.
function scriptJson(value) {
  return JSON.stringify(value).replace(
    UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const config = { supabaseUrl: publicSupabaseUrl(), anonKey: anonKey() };
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`window.__COSIGN_PUBLIC__ = ${scriptJson(config)};\n`);
}
