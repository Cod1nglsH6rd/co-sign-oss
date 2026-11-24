/**
 * Live checks for the keys the owner pastes during setup. Each check makes
 * one call that costs nothing (Anthropic: list models; Resend: list domains),
 * stops after 10 seconds, and answers { ok: true } or { ok: false, message }
 * with a plain message for the owner. No message or log line contains the key.
 *
 * fetch can be injected: checkAnthropicKey(key, { fetch }).
 */

const TIME_LIMIT_MS = 10000;

const ANTHROPIC = {
  name: 'Anthropic',
  url: 'https://api.anthropic.com/v1/models',
  headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  refused: 'Anthropic refused that key. Check it and paste it again.',
};

const RESEND = {
  name: 'Resend',
  url: 'https://api.resend.com/domains',
  headers: (key) => ({ Authorization: `Bearer ${key}` }),
  refused: 'Resend refused that key. Check it and paste it again.',
  // A send-only key may not list domains; Resend answers 401
  // restricted_api_key, which still proves the key is real.
  acceptRefusal: async (res) => {
    if (res.status !== 401) return false;
    try {
      const body = await res.json();
      return Boolean(body) && body.name === 'restricted_api_key';
    } catch {
      return false;
    }
  },
};

function messages(name) {
  return {
    timeout: `${name} did not answer within 10 seconds. Check this server can reach the internet and try again.`,
    network: `Could not reach ${name}. Check this server can reach the internet and try again.`,
    server: `${name} is having trouble right now. Try again in a few minutes.`,
    other: `${name} could not check that key right now. Try again in a few minutes.`,
  };
}

async function checkKey(provider, key, { fetch = globalThis.fetch } = {}) {
  const say = messages(provider.name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIME_LIMIT_MS);
  let res;
  try {
    res = await fetch(provider.url, {
      method: 'GET',
      headers: provider.headers(key),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      console.warn(`[setupChecks] ${provider.name} check timed out`);
      return { ok: false, message: say.timeout };
    }
    // The error text may echo request details, so only its name is logged.
    console.warn(`[setupChecks] ${provider.name} check failed: ${err && err.name}`);
    return { ok: false, message: say.network };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 200) return { ok: true };
  if (provider.acceptRefusal && (await provider.acceptRefusal(res))) return { ok: true };
  console.warn(`[setupChecks] ${provider.name} answered ${res.status}`);
  if (res.status === 401 || res.status === 403) return { ok: false, message: provider.refused };
  if (res.status >= 500) return { ok: false, message: say.server };
  return { ok: false, message: say.other };
}

export function checkAnthropicKey(key, options) {
  return checkKey(ANTHROPIC, key, options);
}

export function checkResendKey(key, options) {
  return checkKey(RESEND, key, options);
}
