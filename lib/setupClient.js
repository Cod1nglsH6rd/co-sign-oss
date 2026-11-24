/**
 * What the setup page calls to load and save the owner's answers at
 * /api/setup/settings. fetch is passed in, so the page uses window.fetch and
 * tests pass a stand-in.
 *
 * The setup code goes in the x-setup-code header, never in the URL.
 *
 * - loadSettings(code, fetchImpl) GETs the settings view.
 * - saveSettings(code, answers, fetchImpl) POSTs the answers as JSON.
 *
 * Each resolves one of:
 *   { kind: 'ok', settings }       on 200
 *   { kind: 'errors', errors }     on 400 { errors: { NAME: message } }
 *   { kind: 'code', message }      on 401 when GET /api/setup/state says
 *                                  { needed: true }: type the code again,
 *                                  with the 401's error text
 *   { kind: 'signin' }             on 401 when it says { needed: false }
 *   { kind: 'failed', message }    on any other answer, with the API's
 *                                  error text when it sent one
 * The state call carries no setup code; if it throws or is not 200 the
 * answer is failed with REACH_MESSAGE.
 * A thrown fetch or a body that cannot be read resolves failed with
 * REACH_MESSAGE. Neither call ever rejects.
 */

const SETTINGS_URL = '/api/setup/settings';
const STATE_URL = '/api/setup/state';
const REACH_MESSAGE = 'Could not reach the server, try again.';

async function refused(fetchImpl, message) {
  let body;
  try {
    const response = await fetchImpl(STATE_URL, { method: 'GET' });
    if (response.status !== 200) return { kind: 'failed', message: REACH_MESSAGE };
    body = await response.json();
  } catch (err) {
    return { kind: 'failed', message: REACH_MESSAGE };
  }
  if (body && body.needed === true) return { kind: 'code', message };
  if (body && body.needed === false) return { kind: 'signin' };
  return { kind: 'failed', message: REACH_MESSAGE };
}

async function ask(fetchImpl, init) {
  let response;
  let body;
  try {
    response = await fetchImpl(SETTINGS_URL, init);
    body = await response.json();
  } catch (err) {
    return { kind: 'failed', message: REACH_MESSAGE };
  }
  if (!body || typeof body !== 'object') {
    return { kind: 'failed', message: REACH_MESSAGE };
  }
  if (response.status === 200 && body.settings && typeof body.settings === 'object') {
    return { kind: 'ok', settings: body.settings };
  }
  if (response.status === 400 && body.errors && typeof body.errors === 'object') {
    return { kind: 'errors', errors: body.errors };
  }
  const hasError = typeof body.error === 'string' && body.error.trim() !== '';
  if (response.status === 401) {
    return refused(fetchImpl, hasError ? body.error : REACH_MESSAGE);
  }
  if (hasError) {
    return { kind: 'failed', message: body.error };
  }
  return { kind: 'failed', message: REACH_MESSAGE };
}

function loadSettings(code, fetchImpl) {
  return ask(fetchImpl, {
    method: 'GET',
    headers: { 'x-setup-code': code },
  });
}

function saveSettings(code, answers, fetchImpl) {
  let body;
  try {
    body = JSON.stringify(answers || {});
  } catch (err) {
    return Promise.resolve({ kind: 'failed', message: REACH_MESSAGE });
  }
  return ask(fetchImpl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-setup-code': code },
    body,
  });
}

module.exports = { loadSettings, saveSettings, REACH_MESSAGE };
