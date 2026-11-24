/**
 * Auth Page — sign in, sign up, and forgot-password
 * Supabase email/password auth
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FiArrowLeft, FiLock, FiMail, FiUser } from 'react-icons/fi';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

const MIN_PASSWORD_LENGTH = 8;

export default function Login() {
  const t = useTranslations();
  const router = useRouter();
  const locale = router.query?.locale || 'en';
  // 'login' | 'signup' | 'forgot'
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Post-submit notices that replace the form (confirm-email / reset-link sent)
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!router.isReady) return;
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const currentLocale = router.query?.locale || 'en';
        router.push(`/${currentLocale}/dashboard`);
      }
    };
    checkSession();
  }, [router.isReady, router.query?.locale, router]);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice(null);
    setPassword('');
    setConfirmPassword('');
  };

  const handleLogin = async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(t('auth.login.invalidCredentials'));
      toast.error(t('auth.login.loginFailed'));
      return;
    }

    toast.success(t('dashboard.welcome'));
    router.push(`/${locale}/dashboard`);
  };

  const handleSignup = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.signup.passwordHint'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.signup.passwordMismatch'));
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/${locale}/login`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data?.session) {
      // Email confirmations disabled — signed in immediately.
      toast.success(t('dashboard.welcome'));
      router.push(`/${locale}/dashboard`);
      return;
    }

    // Confirmation email sent (also shown when the email is already registered,
    // so addresses can't be enumerated from this form).
    setNotice(t('auth.signup.confirmSent'));
  };

  const handleForgot = async () => {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/${locale}/reset-password`,
    });
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setNotice(t('auth.forgot.sent'));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') await handleLogin();
      else if (mode === 'signup') await handleSignup();
      else await handleForgot();
    } catch (err) {
      setError(t('auth.login.loginFailed'));
      toast.error(t('auth.login.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === 'login' ? t('auth.login.title')
      : mode === 'signup' ? t('auth.signup.title')
        : t('auth.forgot.title');
  const subtitle =
    mode === 'login' ? t('auth.login.subtitle')
      : mode === 'signup' ? t('auth.signup.subtitle')
        : t('auth.forgot.subtitle');
  const submitLabel =
    mode === 'login' ? t('auth.login.submit')
      : mode === 'signup' ? t('auth.signup.submit')
        : t('auth.forgot.submit');
  const submitDisabled =
    loading || !email || (mode !== 'forgot' && !password) || (mode === 'signup' && !confirmPassword);

  return (
    <>
      <Head>
        <title>{`${title} — Cô Sign`}</title>
      </Head>

      <div className="min-h-screen bg-slateish-50 flex flex-col">
        {/* Back to home */}
        <div className="p-6">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-2 text-slateish-600 hover:text-slateish-900 transition-colors"
          >
            <FiArrowLeft className="w-4 h-4" />
            <span className="text-sm">Cô Sign</span>
          </Link>
        </div>

        {/* Auth Card */}
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            {/* Card */}
            <div className="bg-white rounded-2xl shadow-xl border border-slateish-100 p-8">
              {/* Logo */}
              <div className="text-center mb-8">
                <span className="text-3xl font-bold text-brand-600">Cô Sign</span>
                <h1 className="text-2xl font-bold text-slateish-900 mt-4">{title}</h1>
                <p className="text-slateish-500 mt-2">{subtitle}</p>
              </div>

              {notice ? (
                <div className="text-center space-y-6">
                  <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto">
                    <FiMail className="w-7 h-7" />
                  </div>
                  <p className="text-slateish-700">{notice}</p>
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="text-sm font-semibold text-brand-600 hover:text-brand-700"
                  >
                    {t('auth.forgot.back')}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                      {t('auth.login.email')}
                    </label>
                    <div className="relative">
                      <FiUser className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slateish-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setError(''); }}
                        placeholder="Enter email"
                        autoComplete="email"
                        autoFocus
                        className="w-full border border-slateish-200 rounded-xl pl-11 pr-4 py-3 text-slateish-700 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {mode !== 'forgot' && (
                    <div>
                      <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                        {t('auth.login.password')}
                      </label>
                      <div className="relative">
                        <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slateish-400" />
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); setError(''); }}
                          placeholder="Enter password"
                          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          className="w-full border border-slateish-200 rounded-xl pl-11 pr-4 py-3 text-slateish-700 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                        />
                      </div>
                      {mode === 'signup' && (
                        <p className="text-xs text-slateish-400 mt-1">{t('auth.signup.passwordHint')}</p>
                      )}
                    </div>
                  )}

                  {mode === 'signup' && (
                    <div>
                      <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                        {t('auth.signup.confirmPassword')}
                      </label>
                      <div className="relative">
                        <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slateish-400" />
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                          placeholder="Enter password"
                          autoComplete="new-password"
                          className="w-full border border-slateish-200 rounded-xl pl-11 pr-4 py-3 text-slateish-700 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  )}

                  {mode === 'login' && (
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-sm text-brand-600 hover:text-brand-700"
                      >
                        {t('auth.login.forgotPassword')}
                      </button>
                    </div>
                  )}

                  {/* Error message */}
                  {error && (
                    <p className="text-sm text-red-600 text-center">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={submitDisabled}
                    className="w-full bg-brand-600 text-white py-3 rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <FiLock className="w-4 h-4" />
                    )}
                    {submitLabel}
                  </button>
                </form>
              )}

              {/* Mode switch */}
              {!notice && (
                <p className="text-center text-sm text-slateish-500 mt-6">
                  {mode === 'login' ? (
                    <>
                      {t('auth.login.noAccount')}{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('signup')}
                        className="font-semibold text-brand-600 hover:text-brand-700"
                      >
                        {t('auth.login.signup')}
                      </button>
                    </>
                  ) : (
                    <>
                      {t('auth.signup.hasAccount')}{' '}
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className="font-semibold text-brand-600 hover:text-brand-700"
                      >
                        {t('auth.signup.login')}
                      </button>
                    </>
                  )}
                </p>
              )}
            </div>

            {/* Privacy note */}
            <p className="text-center text-xs text-slateish-400 mt-6">
              By signing in, you agree to our{' '}
              <Link href={`/${locale}/terms`} className="underline hover:text-slateish-600">Terms</Link>
              {' '}and{' '}
              <Link href={`/${locale}/privacy`} className="underline hover:text-slateish-600">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export async function getStaticProps({ params }) {
  const { locale } = params;
  return {
    props: {
      messages: (await import(`../../locales/${locale}.json`)).default
    }
  };
}

export async function getStaticPaths() {
  return {
    paths: [
      { params: { locale: 'en' } },
      { params: { locale: 'vi' } },
      { params: { locale: 'es' } },
      { params: { locale: 'pt' } },
      { params: { locale: 'fr' } },
      { params: { locale: 'zh' } },
      { params: { locale: 'yue' } },
      { params: { locale: 'ht' } },
      { params: { locale: 'ne' } }
    ],
    fallback: false
  };
}
