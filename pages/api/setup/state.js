/**
 * GET /api/setup/state: { needed }, whether first-run setup is still needed.
 * No sign-in; it says nothing else (never the setup code or any setting).
 */

import { setupNeeded } from '../../../lib/setupLock';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(200).json({ needed: setupNeeded(process.env, { cwd: process.cwd() }) });
}
