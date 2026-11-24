/**
 * The fields of the first-run setup form: AI provider and key, mail choice
 * (Resend or no mail), and the site address. `settings` is the view from
 * GET /api/setup/settings ({ NAME: { set, source, value } }, keys masked).
 * A saved key shows only its mask and its input starts empty; a name set in
 * env shows 'Set on the host' and has no input. The form keeps its answers
 * in the shape answersToSave (lib/setupFormAnswers.js) reads.
 *
 * Save calls onSave(answersToSave(settings, answers)) and shows 'Checking…'
 * until it settles. onSave resolves { errors: { NAME: message } } (each
 * message shows under its field, typed values stay) or { settings } (the new
 * view: key inputs empty, the new masks show). A rejected onSave shows
 * 'Could not save, try again.'
 */

import React, { useState } from 'react';
import { answersToSave, fieldState } from '../lib/setupFormAnswers';

function savedValue(settings, name) {
  const entry = settings && settings[name];
  return entry && typeof entry.value === 'string' ? entry.value : '';
}

function Field({ settings, name, label, type, value, onChange, error }) {
  const state = fieldState(settings, name);
  if (state.locked) {
    return (
      <div className="mb-4">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-sm text-gray-600">{state.note}</span>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium">
        {label}
        <input
          className="mt-1 block w-full rounded border-gray-300"
          type={type}
          name={name}
          value={value}
          autoComplete="off"
          aria-describedby={error ? `${name}-error` : undefined}
          onChange={(event) => onChange(name, event.target.value)}
        />
      </label>
      {state.mask ? (
        <span className="text-sm text-gray-600">Saved: {state.mask}</span>
      ) : null}
      {error ? (
        <span id={`${name}-error`} className="block text-sm text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export default function SetupForm({ settings: initialSettings, onSave }) {
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [failed, setFailed] = useState(false);
  const [answers, setAnswers] = useState(() => ({
    ANTHROPIC_API_KEY: '',
    mail: savedValue(settings, 'EMAIL_PROVIDER') === 'none' ? 'none' : 'resend',
    RESEND_API_KEY: '',
    EMAIL_FROM: savedValue(settings, 'EMAIL_FROM'),
    NEXT_PUBLIC_APP_URL: savedValue(settings, 'NEXT_PUBLIC_APP_URL'),
  }));
  const set = (name, value) => setAnswers((prev) => ({ ...prev, [name]: value }));
  const mailState = fieldState(settings, 'EMAIL_PROVIDER');

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFailed(false);
    try {
      const result = (await onSave(answersToSave(settings, answers))) || {};
      if (result.errors) {
        setErrors(result.errors);
      } else if (result.settings) {
        setSettings(result.settings);
        setAnswers((prev) => ({ ...prev, ANTHROPIC_API_KEY: '', RESEND_API_KEY: '' }));
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <fieldset className="mb-6">
        <legend className="font-semibold">AI</legend>
        <div className="mb-4">
          <label className="block text-sm font-medium">
            Provider
            <select className="mt-1 block w-full rounded border-gray-300" name="provider" defaultValue="anthropic">
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </label>
        </div>
        <Field
          settings={settings}
          name="ANTHROPIC_API_KEY"
          label="Anthropic API key"
          type="password"
          value={answers.ANTHROPIC_API_KEY}
          onChange={set}
          error={errors.ANTHROPIC_API_KEY}
        />
      </fieldset>

      <fieldset className="mb-6">
        <legend className="font-semibold">Mail</legend>
        {mailState.locked ? (
          <span className="block mb-2 text-sm text-gray-600">{mailState.note}</span>
        ) : null}
        <label className="block text-sm">
          <input
            type="radio"
            name="mail"
            value="resend"
            checked={answers.mail === 'resend'}
            disabled={Boolean(mailState.locked)}
            onChange={() => set('mail', 'resend')}
          />{' '}
          Resend
        </label>
        <label className="block mb-4 text-sm">
          <input
            type="radio"
            name="mail"
            value="none"
            checked={answers.mail === 'none'}
            disabled={Boolean(mailState.locked)}
            onChange={() => set('mail', 'none')}
          />{' '}
          No mail: copy the signing link
        </label>
        {errors.EMAIL_PROVIDER ? (
          <span className="block mb-4 text-sm text-red-600">{errors.EMAIL_PROVIDER}</span>
        ) : null}
        {answers.mail === 'resend' ? (
          <>
            <Field
              settings={settings}
              name="RESEND_API_KEY"
              label="Resend API key"
              type="password"
              value={answers.RESEND_API_KEY}
              onChange={set}
              error={errors.RESEND_API_KEY}
            />
            <Field
              settings={settings}
              name="EMAIL_FROM"
              label="From address"
              type="email"
              value={answers.EMAIL_FROM}
              onChange={set}
              error={errors.EMAIL_FROM}
            />
          </>
        ) : null}
      </fieldset>

      <fieldset className="mb-6">
        <legend className="font-semibold">Site</legend>
        <Field
          settings={settings}
          name="NEXT_PUBLIC_APP_URL"
          label="Site address"
          type="url"
          value={answers.NEXT_PUBLIC_APP_URL}
          onChange={set}
          error={errors.NEXT_PUBLIC_APP_URL}
        />
      </fieldset>

      <button
        type="submit"
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        disabled={busy}
      >
        {busy ? 'Checking…' : 'Save'}
      </button>
      {failed ? <p className="mt-2 text-sm text-red-600">Could not save, try again.</p> : null}
    </form>
  );
}
