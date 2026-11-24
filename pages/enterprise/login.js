/**
 * Enterprise Login Page
 * Redesigned to match Co-Sign landing page aesthetic.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { FiArrowLeft, FiLock, FiUser } from 'react-icons/fi';
import { supabase, urlAuthType, forgetUrlAuthType } from '../../lib/supabaseClient';
import {
  clearPasswordPending, markPasswordPending, markPasswordSaved, passwordStep,
} from '../../lib/invitePassword';
import InvitePasswordForm, { finishPasswordSet } from '../../components/enterprise/InvitePasswordForm';
import { getPostLoginPath } from '../../lib/postLoginPath';
import { DEV_EMAIL } from '../../lib/devLogin';
import toast from 'react-hot-toast';

const DEV_LOGIN_ENABLED = process.env.NODE_ENV === 'development'
  && process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === 'true';
// SAML SSO scaffolding. Supabase Auth is a native SAML 2.0 Service Provider on
// the Pro plan and above. The sign-in path below is real, but stays hidden
// until SSO is actually provisioned (Supabase Pro + an IdP connection
// registered for the customer's email domain) — flip this flag then.
const SSO_ENABLED = process.env.NEXT_PUBLIC_SSO_ENABLED === 'true';
const DEV_USERNAME = 'admin';
const ENTERPRISE_DEV_USERNAME = 'eadmin';
const ENTERPRISE_DEV_EMAIL = 'eadmin@enterprise.test';

export default function EnterpriseLogin() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // The signed-in user ({ id, email, saved }) who still has to choose a
  // password (invite link), or null. saved: the password is set and only the
  // last step is left (passwordStep 'finish').
  const [invited, setInvited] = useState(null);
  const inviteOpen = invited !== null;

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // From an invite link: type=invite in the fragment the auth service
      // returned, read before the client consumed it (lib/supabaseClient.js).
      // It is remembered for this user's id (lib/invitePassword.js), so a
      // reload or a later visit still shows the form. Forging or removing the
      // marker cannot touch someone else's account: the step only ever sets
      // the password of the session's own user. The server's mark on the
      // account (app_metadata.password_pending) shows the form too, in any
      // browser where the person is signed in. Nothing is called from here, so
      // StrictMode's second run of this effect calls nothing twice.
      if (urlAuthType() === 'invite') {
        markPasswordPending(session.user?.id);
        forgetUrlAuthType();
      }
      const step = passwordStep(session.user);
      if (step) {
        const { id, email: userEmail } = session.user;
        setInvited({ id, email: userEmail || '', saved: step === 'finish' });
        return;
      }
      router.push(getPostLoginPath(session?.user?.email));
    };
    checkSession();
  }, [router]);

  const handlePasswordChosen = () => {
    clearPasswordPending();
    toast.success('Password set');
    router.push(getPostLoginPath(invited?.email));
  };

  // The password is saved but the mark could not be cleared. The saved entry
  // stays, so the enterprise pages let the person through and the next
  // password sign-in tries that step again (passwordStep 'finish').
  const handleGoOn = () => {
    router.push(getPostLoginPath(invited?.email));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let email = username.trim();
      if (!email.includes('@') && DEV_LOGIN_ENABLED) {
        if (email === DEV_USERNAME) email = DEV_EMAIL;
        if (email === ENTERPRISE_DEV_USERNAME) email = ENTERPRISE_DEV_EMAIL;
      }

      const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError('Invalid username or password');
        toast.error('Invalid credentials');
        setLoading(false);
        return;
      }

      // A password sign-in shows the account has a password: an invite step
      // left in this browser (say, the password was set elsewhere) is done.
      clearPasswordPending();
      // The server may still mark the account (the password was set, but
      // POST /api/account/password-set never answered): finish that step now,
      // the route and then the refresh. The sign-in itself shows the password
      // exists, so if either fails the form opens at its retry line, with Go
      // on, never at a new password.
      const session = signedIn?.session;
      if (session?.user?.app_metadata?.password_pending === true) {
        markPasswordSaved(session.user.id);
        if (!(await finishPasswordSet(session.access_token, session.user.id))) {
          setInvited({ id: session.user.id, email: session.user.email || '', saved: true });
          return;
        }
        clearPasswordPending();
      }
      toast.success('Welcome back!');
      router.push(getPostLoginPath(email));
    } catch (err) {
      setError('Login failed');
      toast.error('Login failed');
    } finally {
      setLoading(false);
    }
  };

  // SAML SSO: redirect to the customer's IdP based on their work-email domain.
  const handleSSO = async () => {
    setError('');
    const entered = username.trim();
    const domain = entered.includes('@') ? entered.split('@')[1] : entered;
    if (!domain) {
      setError('Enter your work email to sign in with SSO');
      return;
    }
    setLoading(true);
    try {
      const { data, error: ssoError } = await supabase.auth.signInWithSSO({ domain });
      if (ssoError) {
        setError('SSO is not configured for this domain');
        setLoading(false);
        return;
      }
      if (data?.url) {
        window.location.href = data.url; // hand off to the identity provider
        return;
      }
      setError('SSO sign-in failed');
    } catch (err) {
      setError('SSO sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Enterprise Login — Co Sign</title>
      </Head>

      <div className="login-page">
        <div className="login-bg" />

        <div className="login-back-row">
          <Link href="/enterprise" className="login-back-link">
            <FiArrowLeft className="w-4 h-4" />
            <span>Co Sign Enterprise</span>
          </Link>
        </div>

        <div className="login-center">
          <div className="login-card">
            <div className="login-card-header">
              <Link href="/" className="login-logo">
                <img src="/logo/cosign-logo.png" alt="Co Sign" style={{ height: 36, width: 'auto' }} />
              </Link>
              <h1>{inviteOpen ? 'Choose a password' : 'Enterprise Login'}</h1>
              <p>{inviteOpen ? 'You will sign in with it from now on.' : 'Sign in to manage enterprise documents.'}</p>
            </div>

            {inviteOpen ? (
              <InvitePasswordForm
                userId={invited.id}
                email={invited.email}
                passwordSaved={invited.saved === true}
                onDone={handlePasswordChosen}
                onGoOn={handleGoOn}
              />
            ) : (
            <form onSubmit={handleLogin} className="login-form">
              <div className="login-field">
                <label>Username or Email</label>
                <div className="login-input-wrap">
                  <FiUser className="login-input-icon" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="name@company.com"
                    required
                  />
                </div>
              </div>

              <div className="login-field">
                <label>Password</label>
                <div className="login-input-wrap">
                  <FiLock className="login-input-icon" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="login-error">{error}</div>
              )}

              <button type="submit" disabled={loading} className="login-submit">
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
            )}

            {SSO_ENABLED && !inviteOpen && (
              <>
                <div className="login-divider"><span>or</span></div>
                <button type="button" onClick={handleSSO} disabled={loading} className="login-sso">
                  Sign in with SSO
                </button>
              </>
            )}

            <div className="login-footer-text">
              <span className="login-dot" />
              Secure enterprise authentication
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .login-page {
          min-height: 100vh; display: flex; flex-direction: column;
          font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
          -webkit-font-smoothing: antialiased;
          position: relative; overflow: hidden;
        }
        .login-bg {
          position: absolute; inset: 0; z-index: 0;
          background:
            radial-gradient(circle at 10% 10%, rgba(84,95,203,0.12), transparent 45%),
            radial-gradient(circle at 90% 20%, rgba(155,166,230,0.16), transparent 45%),
            linear-gradient(160deg, #fff 0%, #f6fbfc 35%, #eef1fb 75%, #fff 100%);
        }
        .login-back-row { position: relative; z-index: 1; padding: 24px 28px; }
        .login-back-link {
          display: inline-flex; align-items: center; gap: 8px;
          color: #6f7b84; font-size: 14px; font-weight: 500;
          text-decoration: none; transition: color .2s;
        }
        .login-back-link:hover { color: #545fcb; }
        .login-center {
          position: relative; z-index: 1;
          flex: 1; display: flex;
          align-items: center; justify-content: center;
          padding: 0 20px 48px;
        }
        .login-card {
          width: 100%; max-width: 440px;
          background: rgba(255,255,255,0.82);
          backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
          border-radius: 28px; border: 1px solid #dfe4f7;
          box-shadow: 0 8px 40px rgba(84,95,203,.08);
          padding: 36px 32px 28px;
        }
        .login-card-header { text-align: center; margin-bottom: 28px; }
        .login-logo { display: inline-block; margin-bottom: 16px; }
        .login-card-header h1 {
          font-size: 24px; font-weight: 800;
          color: #1c2226; letter-spacing: -.3px; margin: 0;
        }
        .login-card-header p { font-size: 14px; color: #6f7b84; margin-top: 6px; }
        .login-form { display: flex; flex-direction: column; gap: 16px; }
        .login-field label {
          display: block; font-size: 13px; font-weight: 600;
          color: #3f4950; margin-bottom: 6px;
        }
        .login-input-wrap { position: relative; }
        .login-input-icon {
          position: absolute; left: 14px; top: 50%;
          transform: translateY(-50%); color: #9aa7b0;
          width: 16px; height: 16px;
        }
        .login-input-wrap input {
          width: 100%; padding: 12px 16px 12px 40px;
          border: 1px solid #dde3e7; border-radius: 14px;
          font-size: 14px; color: #2b3338; font-family: inherit;
          background: rgba(255,255,255,.6); transition: all .2s;
        }
        .login-input-wrap input:focus {
          outline: none; border-color: #7782da;
          box-shadow: 0 0 0 4px rgba(84,95,203,.1); background: #fff;
        }
        .login-error {
          font-size: 13px; color: #ef4444; background: #fef2f2;
          border: 1px solid rgba(239,68,68,.15);
          border-radius: 12px; padding: 10px 14px;
        }
        .login-submit {
          width: 100%; padding: 12px; border-radius: 9999px;
          border: none; background: #4344b3; color: #fff;
          font-size: 15px; font-weight: 700; font-family: inherit;
          cursor: pointer; transition: background .2s;
        }
        .login-submit:hover { background: #383a93; }
        .login-submit:disabled { opacity: .55; cursor: default; }
        .login-divider {
          display: flex; align-items: center; text-align: center;
          margin: 18px 0 14px; color: #9aa7b0; font-size: 12px;
        }
        .login-divider::before, .login-divider::after {
          content: ''; flex: 1; height: 1px; background: #e3e8ef;
        }
        .login-divider span { padding: 0 12px; }
        .login-sso {
          width: 100%; padding: 12px; border-radius: 9999px;
          border: 1px solid #c7cdf0; background: #fff; color: #4344b3;
          font-size: 15px; font-weight: 700; font-family: inherit;
          cursor: pointer; transition: all .2s;
        }
        .login-sso:hover { background: #f3f4fd; }
        .login-sso:disabled { opacity: .55; cursor: default; }
        .login-footer-text {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          margin-top: 20px; font-size: 12px; color: #9aa7b0;
        }
        .login-dot { width: 6px; height: 6px; border-radius: 50%; background: #545fcb; }
      `}</style>
    </>
  );
}

export async function getServerSideProps() {
  const messages = require('../../locales/en.json');
  return { props: { messages } };
}
