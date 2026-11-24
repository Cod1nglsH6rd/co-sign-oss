/**
 * Who may use the setup routes.
 *
 * authorizeSetupRequest(req, res) resolves { via, user } when the request may
 * go on, or sends the refusal on res and resolves null.
 *
 * - While setup is needed (lib/setupLock.js setupNeeded), only the host's
 *   setup code in the x-setup-code header gets in ({ via: 'code' }). A wrong
 *   or missing code gets 401. Every code attempt counts toward the public
 *   rate limit (lib/rateLimit.js) before the code is checked, so after the
 *   limit even a right code gets 429 until the window passes.
 * - Once setup is not needed, the setup code means nothing: only a signed-in
 *   owner gets in ({ via: 'owner', user }). No or a bad Bearer token gets
 *   401; a signed-in user not on the owner list gets 403. The owner list is
 *   ADMIN_DASHBOARD_EMAILS, then NEXT_PUBLIC_OWNER_EMAILS from env, then
 *   ADMIN_DASHBOARD_EMAILS saved on the host, the first that names someone.
 */

import { readSavedSettings } from './hostSettings';
import { isOwnerEmail, parseOwnerEmails } from './ownerEmails';
import { rateLimitPublic } from './rateLimit';
import { setupNeeded, verifySetupCode } from './setupLock';
import { requireServiceSupabase } from './supabaseClient';

function ownerEmails(env, options) {
  const lists = [
    env.ADMIN_DASHBOARD_EMAILS,
    env.NEXT_PUBLIC_OWNER_EMAILS,
    readSavedSettings(options).ADMIN_DASHBOARD_EMAILS,
  ].map(parseOwnerEmails);
  return lists.find((list) => list.length > 0) || [];
}

function refuse(res, status, error) {
  res.status(status).json({ error });
  return null;
}

export async function authorizeSetupRequest(req, res) {
  const env = process.env;
  const options = { cwd: process.cwd() };

  if (setupNeeded(env, options)) {
    if (await rateLimitPublic(req, res, 'setup-code')) return null;
    const code = req.headers['x-setup-code'];
    if (!verifySetupCode(code, env, options)) {
      return refuse(res, 401, 'The setup code is missing or wrong. Find it in the server log or in .cosign/setup-code on the host.');
    }
    return { via: 'code', user: null };
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return refuse(res, 401, 'Setup is finished. Sign in as an owner to change settings.');
  }
  const supabase = requireServiceSupabase();
  const { data, error } = await supabase.auth.getUser(authHeader.slice('Bearer '.length));
  const user = data?.user;
  if (error || !user) {
    return refuse(res, 401, 'Your sign-in has expired. Sign in again.');
  }
  if (!isOwnerEmail(user.email, ownerEmails(env, options))) {
    return refuse(res, 403, 'Only an owner can change settings.');
  }
  return { via: 'owner', user };
}
