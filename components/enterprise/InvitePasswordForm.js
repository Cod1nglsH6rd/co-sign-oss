/**
 * The password step for someone who arrives at /enterprise/login from an
 * invite link: the account's email (read-only), a new password and its
 * confirmation. Uses the sign-in page's login-* styles. updateUser acts on the
 * signed-in session only, so this sets the password of the session's own
 * user and no one else's. The session is shared by every tab of the browser:
 * if another account was signed in elsewhere since the form opened for
 * userId, nothing is saved or retried and the person is asked to reload. Once
 * the password is saved, POST /api/account/password-set clears the server's
 * password_pending mark and the session is refreshed so its user no longer
 * carries it, then onDone runs. If that last step fails, the form says the
 * password is saved and offers to retry only that step, or to go on (onGoOn;
 * see passwordStep in lib/invitePassword.js); it never asks for the password
 * again. passwordSaved opens the form at that retry line.
 */

import { useState } from 'react';
import { FiLock, FiUser } from 'react-icons/fi';
import { supabase } from '../../lib/supabaseClient';
import { markPasswordSaved } from '../../lib/invitePassword';
import { MIN_PASSWORD_LENGTH } from '../../lib/firstAdminInput';

const OTHER_ACCOUNT = 'This browser is no longer signed in to this account. Reload the page.';

// The route, then the refresh. True only when both worked and the refreshed
// session is still userId's and no longer carries the mark. refreshSession
// saves the new session in the auth client and awaits every
// onAuthStateChange listener (hooks/useAuth.js) before it resolves, so the
// next page reads the user without the mark.
export async function finishPasswordSet(accessToken, userId) {
  try {
    const res = await fetch('/api/account/password-set', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const { data, error } = await supabase.auth.refreshSession();
    const user = data?.session?.user;
    if (error || !user || user.id !== userId) return false;
    return user.app_metadata?.password_pending !== true;
  } catch {
    return false;
  }
}

export default function InvitePasswordForm({ userId, email, onDone, onGoOn, passwordSaved = false }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The password is saved; only the last step (route, then refresh) is left.
  const [finishFailed, setFinishFailed] = useState(passwordSaved);

  const finish = async (accessToken) => {
    if (await finishPasswordSet(accessToken, userId)) {
      onDone();
      return;
    }
    setFinishFailed(true);
    setSaving(false);
  };

  // Only for the user the form opened for: another account signed in from
  // another tab is not touched.
  const handleRetry = async () => {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user?.id !== userId) {
        setError(OTHER_ACCOUNT);
        setSaving(false);
        return;
      }
      await finish(data.session.access_token);
    } catch {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user?.id !== userId) {
        setError(OTHER_ACCOUNT);
        setSaving(false);
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(`The password was not saved: ${updateError.message || 'please try again.'}`);
        setSaving(false);
        return;
      }
      markPasswordSaved(userId);
      await finish(data.session.access_token);
    } catch (err) {
      setError('The password was not saved: please try again.');
      setSaving(false);
    }
  };

  if (finishFailed) {
    return (
      <div className="login-form">
        <div className="login-error" role="alert">
          {error || 'Your password is saved, but the last step could not be finished. Try again, or go on: it is tried again the next time you sign in.'}
        </div>
        <button type="button" onClick={handleRetry} disabled={saving} className="login-submit">
          {saving ? 'Trying…' : 'Try again'}
        </button>
        {onGoOn && (
          <button type="button" onClick={onGoOn} disabled={saving} className="login-sso">
            Go on
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <div className="login-field">
        <label htmlFor="invite-email">Email</label>
        <div className="login-input-wrap">
          <FiUser className="login-input-icon" />
          <input id="invite-email" type="email" value={email} readOnly />
        </div>
      </div>

      <div className="login-field">
        <label htmlFor="invite-password">New password</label>
        <div className="login-input-wrap">
          <FiLock className="login-input-icon" />
          <input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            required
          />
        </div>
      </div>

      <div className="login-field">
        <label htmlFor="invite-confirm">Confirm password</label>
        <div className="login-input-wrap">
          <FiLock className="login-input-icon" />
          <input
            id="invite-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>
      </div>

      {error && (
        <div className="login-error" role="alert">{error}</div>
      )}

      <button type="submit" disabled={saving} className="login-submit">
        {saving ? 'Saving…' : 'Set password'}
      </button>
    </form>
  );
}
