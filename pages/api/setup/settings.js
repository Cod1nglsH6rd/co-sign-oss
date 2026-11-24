/**
 * GET/POST /api/setup/settings: the owner's setup answers.
 *
 * Access is lib/setupAccess.js: the setup code while setup is needed, a
 * signed-in owner after.
 *
 * - GET answers { settings }, the settingsView from lib/hostSettings.js
 *   (API keys masked).
 * - POST takes any of ANTHROPIC_API_KEY, EMAIL_PROVIDER ('none' or 'resend'),
 *   RESEND_API_KEY, EMAIL_FROM and NEXT_PUBLIC_APP_URL. A name left out stays
 *   as it is; a name set in env is never saved over. Keys are checked live
 *   (lib/setupChecks.js) and the site address is cleaned (lib/siteAddress.js).
 *   If any answer fails, it answers 400 { errors: { NAME: message } } and
 *   saves nothing; otherwise it saves them all and answers { settings }.
 *   'none' saves EMAIL_PROVIDER blank; 'resend' needs a Resend key that
 *   passes, unless one is already set.
 * No response or log line holds a key.
 */

import { effectiveSetting, saveSettings, settingsView } from '../../../lib/hostSettings';
import { authorizeSetupRequest } from '../../../lib/setupAccess';
import { checkAnthropicKey, checkResendKey } from '../../../lib/setupChecks';
import { cleanSiteAddress } from '../../../lib/siteAddress';

function setInEnv(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}

// Every answer is checked before anything is saved.
async function checkAnswers(body, env, options) {
  const errors = {};
  const updates = {};
  const given = (name) => body[name] !== undefined && !setInEnv(env, name);
  const keyText = (name) => (typeof body[name] === 'string' ? body[name].trim() : '');
  const live = [];

  if (given('ANTHROPIC_API_KEY')) {
    const key = keyText('ANTHROPIC_API_KEY');
    if (!key) {
      errors.ANTHROPIC_API_KEY = 'Paste your Anthropic key.';
    } else {
      live.push(checkAnthropicKey(key).then((result) => {
        if (result.ok) updates.ANTHROPIC_API_KEY = key;
        else errors.ANTHROPIC_API_KEY = result.message;
      }));
    }
  }

  let mail = null;
  if (given('EMAIL_PROVIDER')) {
    mail = body.EMAIL_PROVIDER;
    if (mail === 'none') updates.EMAIL_PROVIDER = '';
    else if (mail === 'resend') updates.EMAIL_PROVIDER = 'resend';
    else errors.EMAIL_PROVIDER = "Choose 'none' or 'resend' for mail.";
  }

  if (mail !== 'none' && given('RESEND_API_KEY')) {
    const key = keyText('RESEND_API_KEY');
    if (!key) {
      errors.RESEND_API_KEY = 'Paste your Resend key.';
    } else {
      live.push(checkResendKey(key).then((result) => {
        if (result.ok) updates.RESEND_API_KEY = key;
        else errors.RESEND_API_KEY = result.message;
      }));
    }
  } else if (mail === 'resend' && !effectiveSetting('RESEND_API_KEY', env, options)) {
    errors.RESEND_API_KEY = 'Paste your Resend key to send mail with Resend.';
  }

  if (given('EMAIL_FROM')) {
    if (typeof body.EMAIL_FROM === 'string') updates.EMAIL_FROM = body.EMAIL_FROM.trim();
    else errors.EMAIL_FROM = 'Type the address mail should come from.';
  }

  if (given('NEXT_PUBLIC_APP_URL')) {
    const site = cleanSiteAddress(body.NEXT_PUBLIC_APP_URL);
    if (site.ok) updates.NEXT_PUBLIC_APP_URL = site.address;
    else errors.NEXT_PUBLIC_APP_URL = site.message;
  }

  await Promise.all(live);
  return { errors, updates };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await authorizeSetupRequest(req, res))) return undefined;

  res.setHeader('Cache-Control', 'no-store');
  const env = process.env;
  const options = { cwd: process.cwd() };

  if (req.method === 'POST') {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Send the settings as a JSON object.' });
    }
    const { errors, updates } = await checkAnswers(body, env, options);
    if (Object.keys(errors).length > 0) return res.status(400).json({ errors });
    try {
      saveSettings(updates, options);
    } catch (err) {
      // Only the error code: the message could name the folder, never a key,
      // but nothing more is needed to find the cause.
      console.error(`[setup/settings] could not save settings: ${err && err.code}`);
      return res.status(500).json({ error: 'Could not save the settings on this server. Check the .cosign folder can be written.' });
    }
  }

  return res.status(200).json({ settings: settingsView(env, options) });
}
