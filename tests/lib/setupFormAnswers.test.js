/**
 * @jest-environment node
 */

/**
 * lib/setupFormAnswers.js builds what the setup form's Save sends.
 *
 * - answersToSave(settings, answers) takes the settings view from
 *   GET /api/setup/settings ({ NAME: { set, source, value } }) and the form's
 *   answers ({ ANTHROPIC_API_KEY, mail, RESEND_API_KEY, EMAIL_FROM,
 *   NEXT_PUBLIC_APP_URL }, mail being 'none' or 'resend') and returns only
 *   the names the user changed. A blank key is never sent, a name set in env
 *   is never sent, 'No mail' sends EMAIL_PROVIDER 'none' and nothing about
 *   Resend, and 'resend' is sent only when it changed.
 * - fieldState(settings, NAME) says how a field starts: locked for env,
 *   masked and empty for a key already set.
 * No DOM, no fetch. The key values are made-up placeholders.
 */

function load() {
  const mod = require('../../lib/setupFormAnswers');
  expect(typeof mod.answersToSave).toBe('function');
  expect(typeof mod.fieldState).toBe('function');
  return mod;
}

const unset = { set: false, source: null, value: null };

// A fresh install: nothing set anywhere.
function freshSettings() {
  return {
    ANTHROPIC_API_KEY: { ...unset },
    EMAIL_PROVIDER: { ...unset },
    RESEND_API_KEY: { ...unset },
    EMAIL_FROM: { ...unset },
    NEXT_PUBLIC_APP_URL: { ...unset },
    ADMIN_DASHBOARD_EMAILS: { ...unset },
  };
}

// An install already set up through the form, sending mail with Resend.
function savedSettings() {
  return {
    ANTHROPIC_API_KEY: { set: true, source: 'saved', value: '7890' },
    EMAIL_PROVIDER: { set: true, source: 'saved', value: 'resend' },
    RESEND_API_KEY: { set: true, source: 'saved', value: '4321' },
    EMAIL_FROM: { set: true, source: 'saved', value: 'sign@example.com' },
    NEXT_PUBLIC_APP_URL: { set: true, source: 'saved', value: 'https://sign.example.com' },
    ADMIN_DASHBOARD_EMAILS: { ...unset },
  };
}

// The form as it first appears for savedSettings(): keys empty, the rest as saved.
function untouchedAnswers() {
  return {
    ANTHROPIC_API_KEY: '',
    mail: 'resend',
    RESEND_API_KEY: '',
    EMAIL_FROM: 'sign@example.com',
    NEXT_PUBLIC_APP_URL: 'https://sign.example.com',
  };
}

describe('answersToSave', () => {
  test('an untouched form sends nothing', () => {
    const { answersToSave } = load();
    expect(answersToSave(savedSettings(), untouchedAnswers())).toEqual({});
  });

  test('sends only the names the user changed', () => {
    const { answersToSave } = load();
    const answers = { ...untouchedAnswers(), EMAIL_FROM: 'docs@example.com', ANTHROPIC_API_KEY: 'placeholder-anthropic-0001' };
    expect(answersToSave(savedSettings(), answers)).toEqual({
      ANTHROPIC_API_KEY: 'placeholder-anthropic-0001',
      EMAIL_FROM: 'docs@example.com',
    });
  });

  test('a typed key is sent trimmed', () => {
    const { answersToSave } = load();
    const answers = { ...untouchedAnswers(), RESEND_API_KEY: '  placeholder-resend-0002 ' };
    expect(answersToSave(savedSettings(), answers)).toEqual({ RESEND_API_KEY: 'placeholder-resend-0002' });
  });

  test('never sends a blank or whitespace API key', () => {
    const { answersToSave } = load();
    for (const blank of ['', '   ', '\t\n', undefined]) {
      const answers = { ...untouchedAnswers(), ANTHROPIC_API_KEY: blank, RESEND_API_KEY: blank };
      const sent = answersToSave(savedSettings(), answers);
      expect(sent).not.toHaveProperty('ANTHROPIC_API_KEY');
      expect(sent).not.toHaveProperty('RESEND_API_KEY');
    }
    const fresh = answersToSave(freshSettings(), {
      ANTHROPIC_API_KEY: '  ', mail: 'resend', RESEND_API_KEY: ' ', EMAIL_FROM: '', NEXT_PUBLIC_APP_URL: '',
    });
    expect(fresh).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(fresh).not.toHaveProperty('RESEND_API_KEY');
  });

  test('never sends a name whose source is env', () => {
    const { answersToSave } = load();
    const settings = {
      ANTHROPIC_API_KEY: { set: true, source: 'env', value: 'aaaa' },
      EMAIL_PROVIDER: { set: true, source: 'env', value: 'resend' },
      RESEND_API_KEY: { set: true, source: 'env', value: 'bbbb' },
      EMAIL_FROM: { set: true, source: 'env', value: 'host@example.com' },
      NEXT_PUBLIC_APP_URL: { set: true, source: 'env', value: 'https://host.example.com' },
      ADMIN_DASHBOARD_EMAILS: { ...unset },
    };
    const answers = {
      ANTHROPIC_API_KEY: 'placeholder-anthropic-0003',
      mail: 'none',
      RESEND_API_KEY: 'placeholder-resend-0004',
      EMAIL_FROM: 'other@example.com',
      NEXT_PUBLIC_APP_URL: 'https://other.example.com',
    };
    expect(answersToSave(settings, answers)).toEqual({});
  });

  test("mail 'none' sends EMAIL_PROVIDER 'none' and drops the Resend key and from address", () => {
    const { answersToSave } = load();
    const answers = {
      ...untouchedAnswers(),
      mail: 'none',
      RESEND_API_KEY: 'placeholder-resend-0005',
      EMAIL_FROM: 'changed@example.com',
    };
    expect(answersToSave(savedSettings(), answers)).toEqual({ EMAIL_PROVIDER: 'none' });
  });

  test("mail 'none' on a fresh install sends EMAIL_PROVIDER 'none' and nothing about Resend", () => {
    const { answersToSave } = load();
    const sent = answersToSave(freshSettings(), {
      ANTHROPIC_API_KEY: 'placeholder-anthropic-0006',
      mail: 'none',
      RESEND_API_KEY: 'placeholder-resend-0007',
      EMAIL_FROM: 'sign@example.com',
      NEXT_PUBLIC_APP_URL: '',
    });
    expect(sent).toEqual({ ANTHROPIC_API_KEY: 'placeholder-anthropic-0006', EMAIL_PROVIDER: 'none' });
  });

  test("mail 'resend' sends EMAIL_PROVIDER 'resend' only when it changed", () => {
    const { answersToSave } = load();
    expect(answersToSave(savedSettings(), untouchedAnswers())).not.toHaveProperty('EMAIL_PROVIDER');

    const fresh = answersToSave(freshSettings(), {
      ANTHROPIC_API_KEY: '',
      mail: 'resend',
      RESEND_API_KEY: 'placeholder-resend-0008',
      EMAIL_FROM: 'sign@example.com',
      NEXT_PUBLIC_APP_URL: '',
    });
    expect(fresh).toEqual({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'placeholder-resend-0008',
      EMAIL_FROM: 'sign@example.com',
    });
  });

  test('an unchanged site address is left out, a changed one is sent', () => {
    const { answersToSave } = load();
    const same = { ...untouchedAnswers(), NEXT_PUBLIC_APP_URL: '  https://sign.example.com ' };
    expect(answersToSave(savedSettings(), same)).not.toHaveProperty('NEXT_PUBLIC_APP_URL');

    const blankOnFresh = answersToSave(freshSettings(), {
      ANTHROPIC_API_KEY: '', mail: 'resend', RESEND_API_KEY: '', EMAIL_FROM: '', NEXT_PUBLIC_APP_URL: '  ',
    });
    expect(blankOnFresh).not.toHaveProperty('NEXT_PUBLIC_APP_URL');

    const moved = { ...untouchedAnswers(), NEXT_PUBLIC_APP_URL: 'https://docs.example.com' };
    expect(answersToSave(savedSettings(), moved)).toEqual({ NEXT_PUBLIC_APP_URL: 'https://docs.example.com' });
  });
});

describe('fieldState', () => {
  test("a name set in env is locked with 'Set on the host'", () => {
    const { fieldState } = load();
    const settings = { ...freshSettings(), EMAIL_FROM: { set: true, source: 'env', value: 'host@example.com' } };
    expect(fieldState(settings, 'EMAIL_FROM')).toEqual({ locked: true, note: 'Set on the host' });
    const keyInEnv = { ...freshSettings(), ANTHROPIC_API_KEY: { set: true, source: 'env', value: 'aaaa' } };
    expect(fieldState(keyInEnv, 'ANTHROPIC_API_KEY')).toEqual({ locked: true, note: 'Set on the host' });
  });

  test('a saved key shows its mask and its input starts empty', () => {
    const { fieldState } = load();
    expect(fieldState(savedSettings(), 'ANTHROPIC_API_KEY')).toEqual({ mask: '7890', inputStartsEmpty: true });
    expect(fieldState(savedSettings(), 'RESEND_API_KEY')).toEqual({ mask: '4321', inputStartsEmpty: true });
  });

  test('an unset field is neither locked nor masked', () => {
    const { fieldState } = load();
    const state = fieldState(freshSettings(), 'ANTHROPIC_API_KEY');
    expect(state.locked).toBeFalsy();
    expect(state).not.toHaveProperty('mask');
  });
});
