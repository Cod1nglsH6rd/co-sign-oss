/**
 * GET /api/health
 *
 * Real health check for uptime monitoring: reports which integrations are
 * configured and whether the database answers, plus an `adapters` object
 * saying which outside services are on (lib/adapters.js). Returns 200 when
 * the core (Supabase) is healthy, 503 otherwise; cron and the adapters do not
 * count towards 'ok'. Anthropic counts as configured with an env key or a
 * key saved at setup (lib/hostSettings.js). No secrets are echoed.
 */

import { adapterStatus } from '../../lib/adapters';
import { effectiveSetting } from '../../lib/hostSettings';
import { requireServiceSupabase } from '../../lib/supabaseClient';
import { serverSupabaseUrl, serviceKey } from '../../lib/supabaseEnv';

export default async function handler(req, res) {
  const checks = {
    supabase_env: !!(serverSupabaseUrl() && serviceKey()),
    anthropic_env: !!effectiveSetting('ANTHROPIC_API_KEY', process.env),
    cron_env: !!(process.env.CRON_SECRET || process.env.PROCESS_OCR_CRON_SECRET),
    database: false,
  };

  if (checks.supabase_env) {
    try {
      const supabase = requireServiceSupabase();
      const { error } = await supabase.from('app_config').select('key').limit(1);
      checks.database = !error;
    } catch {
      checks.database = false;
    }
  }

  const healthy = checks.supabase_env && checks.database;
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    app: 'Cô Sign',
    checks,
    adapters: adapterStatus(process.env),
    time: new Date().toISOString(),
  });
}
