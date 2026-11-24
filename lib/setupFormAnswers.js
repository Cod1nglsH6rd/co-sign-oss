/**
 * What the setup form's Save sends to POST /api/setup/settings, and how each
 * field starts. Pure: no DOM, no fetch.
 *
 * `settings` is the view from GET /api/setup/settings
 * ({ NAME: { set, source, value } }, keys masked). `answers` is the form as
 * it is now: { ANTHROPIC_API_KEY, mail, RESEND_API_KEY, EMAIL_FROM,
 * NEXT_PUBLIC_APP_URL }, with mail 'none' or 'resend'.
 *
 * - answersToSave(settings, answers) returns only the names the user
 *   changed. A key input starts empty, so a typed key is a change and a
 *   blank or whitespace one is never sent. A name set in env is never sent.
 *   'No mail' sends EMAIL_PROVIDER 'none' and nothing about Resend; 'resend'
 *   is sent only when it changed. The site address and from address are
 *   compared trimmed, so an unchanged one is left out.
 * - fieldState(settings, NAME) returns { locked: true, note: 'Set on the host' }
 *   for a name set in env, { mask, inputStartsEmpty: true } for a key already
 *   set, and {} otherwise.
 */

const KEY_NAMES = ['ANTHROPIC_API_KEY', 'RESEND_API_KEY'];

function fromEnv(settings, name) {
  return Boolean(settings && settings[name] && settings[name].source === 'env');
}

function trimmed(text) {
  return typeof text === 'string' ? text.trim() : '';
}

function currentValue(settings, name) {
  const entry = settings && settings[name];
  return entry && typeof entry.value === 'string' ? entry.value : '';
}

function answersToSave(settings, answers) {
  const form = answers || {};
  const sent = {};
  const may = (name) => !fromEnv(settings, name);

  const putKey = (name) => {
    const key = trimmed(form[name]);
    if (key && may(name)) sent[name] = key;
  };
  const putText = (name) => {
    const text = trimmed(form[name]);
    if (text !== currentValue(settings, name) && may(name)) sent[name] = text;
  };

  putKey('ANTHROPIC_API_KEY');

  if (form.mail === 'none') {
    if (may('EMAIL_PROVIDER')) sent.EMAIL_PROVIDER = 'none';
  } else if (form.mail === 'resend') {
    if (currentValue(settings, 'EMAIL_PROVIDER') !== 'resend' && may('EMAIL_PROVIDER')) {
      sent.EMAIL_PROVIDER = 'resend';
    }
    putKey('RESEND_API_KEY');
    putText('EMAIL_FROM');
  }

  putText('NEXT_PUBLIC_APP_URL');
  return sent;
}

function fieldState(settings, name) {
  if (fromEnv(settings, name)) return { locked: true, note: 'Set on the host' };
  const entry = settings && settings[name];
  if (KEY_NAMES.includes(name) && entry && entry.set) {
    return { mask: entry.value, inputStartsEmpty: true };
  }
  return {};
}

module.exports = { answersToSave, fieldState };
