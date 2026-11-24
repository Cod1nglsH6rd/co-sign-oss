/**
 * First-run setup page. Asks for the setup code first, then loads the saved
 * settings with it (lib/setupClient.js, code in the x-setup-code header) and
 * shows SetupForm. A refused code shows the API's error text by the code box
 * while setup is needed, or asks to sign in as an admin once it is done.
 * Save sends the edited answers with the same code (saveSettings) and hands
 * { errors } or { settings } back to the form; a code refused during save
 * goes back to the code box with its error, or to the sign-in prompt.
 * The code box says where the code is. Once the code loads the settings,
 * SetupFirstAdmin is shown under the form with the same code; when it makes
 * the first admin the page says 'Setup is done. Sign in as <email>' with a
 * link to /enterprise/login.
 * The code lives only in this page's state: never in storage or the URL.
 */

import { useState } from 'react';
import Link from 'next/link';
import SetupFirstAdmin from '../components/SetupFirstAdmin';
import SetupForm from '../components/SetupForm';
import { loadSettings, saveSettings } from '../lib/setupClient';

const callFetch = (url, init) => fetch(url, init);

export default function SetupPage() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [signin, setSignin] = useState(false);
  const [settings, setSettings] = useState(null);
  const [adminEmail, setAdminEmail] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setSignin(false);
    const result = await loadSettings(code.trim(), callFetch);
    setBusy(false);
    if (result.kind === 'ok') {
      setSettings(result.settings);
    } else if (result.kind === 'signin') {
      setSignin(true);
    } else {
      setMessage(result.message || '');
    }
  }

  async function save(answers) {
    const result = await saveSettings(code.trim(), answers, callFetch);
    if (result.kind === 'ok') return { settings: result.settings };
    if (result.kind === 'errors') return { errors: result.errors };
    if (result.kind === 'signin') {
      setSettings(null);
      setSignin(true);
      return {};
    }
    if (result.kind === 'code') {
      setSettings(null);
      setMessage(result.message || '');
      return {};
    }
    throw new Error(result.message || 'Could not save');
  }

  if (adminEmail) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="mb-6 text-2xl font-semibold">Setup</h1>
        <p className="text-sm">
          {`Setup is done. Sign in as ${adminEmail}.`}{' '}
          <Link className="text-blue-600 underline" href="/enterprise/login">
            Sign in
          </Link>
        </p>
      </main>
    );
  }

  if (settings) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="mb-6 text-2xl font-semibold">Setup</h1>
        <SetupForm settings={settings} onSave={save} />
        <SetupFirstAdmin code={code.trim()} onDone={setAdminEmail} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Setup</h1>
      {signin ? (
        <p className="mb-4 text-sm">
          Sign in as an admin to change settings.{' '}
          <Link className="text-blue-600 underline" href="/enterprise/login">
            Sign in
          </Link>
        </p>
      ) : null}
      <form onSubmit={submit} noValidate>
        <label className="block text-sm font-medium">
          Setup code
          <input
            className="mt-1 block w-full rounded border-gray-300"
            type="password"
            name="setupCode"
            value={code}
            autoComplete="off"
            aria-describedby={message ? 'setup-code-error' : undefined}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <span className="block text-sm text-gray-600">
          Find it in the server log, or the file .cosign/setup-code on the host.
        </span>
        {message ? (
          <span id="setup-code-error" className="block text-sm text-red-600">
            {message}
          </span>
        ) : null}
        <button
          type="submit"
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          disabled={busy || code.trim() === ''}
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}
