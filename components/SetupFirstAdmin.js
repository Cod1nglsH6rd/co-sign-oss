/**
 * The first admin account on a fresh install. Shown by pages/setup.js once
 * the setup code has been accepted; `code` is that code.
 *
 * Create admin POSTs { email, password } as JSON to /api/setup/admin with the
 * code in the x-setup-code header. A 201 calls onDone(email), with the email
 * the API sent back; any other answer shows the API's error text (or a
 * could-not-reach sentence) and keeps what was typed. The password is kept
 * only in this component's state.
 */

import React, { useState } from 'react';

const ADMIN_URL = '/api/setup/admin';
const REACH_MESSAGE = 'Could not reach the server, try again.';

export default function SetupFirstAdmin({ code, onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    let response;
    let body;
    try {
      response = await fetch(ADMIN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-setup-code': code },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      body = await response.json();
    } catch {
      setBusy(false);
      setMessage(REACH_MESSAGE);
      return;
    }
    setBusy(false);
    if (response.status === 201) {
      onDone(body && typeof body.email === 'string' ? body.email : email.trim());
      return;
    }
    const hasError = body && typeof body.error === 'string' && body.error.trim() !== '';
    setMessage(hasError ? body.error : REACH_MESSAGE);
  }

  return (
    <form onSubmit={submit} noValidate className="mt-8">
      <fieldset>
        <legend className="font-semibold">First admin</legend>
        <label className="mt-2 block text-sm font-medium">
          Admin email
          <input
            className="mt-1 block w-full rounded border-gray-300"
            type="email"
            name="adminEmail"
            value={email}
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Admin password
          <input
            className="mt-1 block w-full rounded border-gray-300"
            type="password"
            name="adminPassword"
            value={password}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      </fieldset>
      {message ? <p className="mt-2 text-sm text-red-600">{message}</p> : null}
      <button
        type="submit"
        className="mt-4 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        disabled={busy || email.trim() === '' || password === ''}
      >
        {busy ? 'Checking…' : 'Create admin'}
      </button>
    </form>
  );
}
