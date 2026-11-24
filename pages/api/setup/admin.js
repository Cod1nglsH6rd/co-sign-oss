/**
 * POST /api/setup/admin: make the first owner account through the setup code.
 *
 * Access is lib/setupAccess.js: while setup is needed only the right
 * x-setup-code gets in. Once setup is not needed this route is closed: an
 * anonymous request gets 401 there, and even a signed-in owner gets
 * 409 'Setup is already finished', so no second admin is ever made here.
 *
 * - Any method but POST gets 405 with Allow: POST.
 * - A body that is not a JSON object gets 400.
 * - Otherwise it answers what lib/firstAdmin.js createFirstAdmin gives:
 *   201 { email } when the account is made and the email saved as the
 *   owner, which ends setup; 400, 409 or 500 { error } when not.
 * - A throw from it (a file in the .cosign folder, such as the first-admin
 *   lock, could not be changed) gets 500 with a sentence naming that folder.
 * Every answer after access is Cache-Control no-store. No response or log
 * line holds the password.
 */

import { createFirstAdmin } from '../../../lib/firstAdmin';
import { authorizeSetupRequest } from '../../../lib/setupAccess';
import { requireServiceSupabase } from '../../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await authorizeSetupRequest(req, res);
  if (!access) return undefined;

  res.setHeader('Cache-Control', 'no-store');
  if (access.via !== 'code') {
    return res.status(409).json({ error: 'Setup is already finished' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Send the email and password as a JSON object.' });
  }

  let supabase;
  try {
    supabase = requireServiceSupabase();
  } catch (err) {
    console.error(`[setup/admin] Supabase is not set up: ${err && err.name}`);
    return res.status(500).json({ error: 'The account could not be created. Check the Supabase settings on this server.' });
  }

  let result;
  try {
    result = await createFirstAdmin(body, { supabase, env: process.env, cwd: process.cwd() });
  } catch (err) {
    console.error('[setup/admin] A setup file could not be changed', { name: err && err.name, code: err && err.code });
    return res.status(500).json({
      error: 'A setup file in the .cosign folder could not be changed. Check that this server can write to its .cosign folder, then try again.',
    });
  }
  return res.status(result.status).json(result.body);
}
