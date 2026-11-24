/**
 * Reset Password Page
 * Destination of the Supabase password-recovery email link. The recovery link
 * signs the user in with a short-lived session (handled by detectSessionInUrl,
 * plus the global PASSWORD_RECOVERY redirect in _app), and this page lets them
 * set a new password via supabase.auth.updateUser.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FiArrowLeft, FiLock } from 'react-icons/fi';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPassword() {
  const t = useTranslations();
  const router = useRouter();
  const locale = router.query?.locale || 'en';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // null = still resolving; recovery links arrive with a session in the URL hash.
  const [hasSession, setHasSession] = useState(null);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (mounted) setHasSession(!!session);
    };
    check();
    // The hash tokens may still be getting consumed when we first check.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted && session) setHasSession(true);
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.signup.passwordHint'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.signup.passwordMismatch'));
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      toast.success(t('auth.reset.success'));
      router.push(`/${locale}/dashboard`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>{`${t('auth.reset.title')} — Cô Sign`}</title>
      </Head>

      <div className="min-h-screen bg-slateish-50 flex flex-col">
        <div className="p-6">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-2 text-slateish-600 hover:text-slateish-900 transition-colors"
          >
            <FiArrowLeft className="w-4 h-4" />
            <span className="text-sm">Cô Sign</span>
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-2xl shadow-xl border border-slateish-100 p-8">
              <div className="text-center mb-8">
                <span className="text-3xl font-bold text-brand-600">Cô Sign</span>
                <h1 className="text-2xl font-bold text-slateish-900 mt-4">{t('auth.reset.title')}</h1>
                <p className="text-slateish-500 mt-2">{t('auth.reset.subtitle')}</p>
              </div>

              {hasSession === false ? (
                <div className="text-center space-y-6">
                  <p className="text-slateish-700">{t('auth.reset.invalid')}</p>
                  <Link
                    href={`/${locale}/login`}
                    className="inline-block text-sm font-semibold text-brand-600 hover:text-brand-700"
                  >
                    {t('auth.forgot.back')}
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                      {t('auth.reset.newPassword')}
                    </label>
                    <div className="relative">
                      <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slateish-400" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setError(''); }}
                        placeholder="Enter password"
                        autoComplete="new-password"
                        autoFocus
                        className="w-full border border-slateish-200 rounded-xl pl-11 pr-4 py-3 text-slateish-700 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      />
                    </div>
                    <p className="text-xs text-slateish-400 mt-1">{t('auth.signup.passwordHint')}</p>
                  </div>

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

                  {error && (
                    <p className="text-sm text-red-600 text-center">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !password || !confirmPassword || hasSession === null}
                    className="w-full bg-brand-600 text-white py-3 rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <FiLock className="w-4 h-4" />
                    )}
                    {t('auth.reset.submit')}
                  </button>
                </form>
              )}
            </div>
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
