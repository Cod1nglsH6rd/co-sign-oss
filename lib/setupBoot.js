/**
 * Makes the one-time setup code when a fresh install starts.
 *
 * ensureSetupCodeAtBoot({ env, cwd, log }) calls getSetupCode only while
 * setupNeeded(env) is true, so the code is in the server log and in
 * .cosign/setup-code before anyone opens /setup. It returns true when a code
 * exists afterwards. When setup is not needed it does nothing, makes no file
 * and returns false. It never throws: a failure logs one line, with the
 * error's message but never the code, and returns false.
 *
 * Nothing calls it yet: instrumentation.js is a file only a person may
 * change, and a person adds the one call there.
 */

import { getSetupCode, setupNeeded } from './setupLock';

export function ensureSetupCodeAtBoot({ env = process.env, cwd, log = console } = {}) {
  try {
    if (!setupNeeded(env, { cwd })) return false;
    return Boolean(getSetupCode({ cwd, log }));
  } catch (error) {
    log.error(`[setupBoot] Could not make the setup code: ${error && error.message}`);
    return false;
  }
}
