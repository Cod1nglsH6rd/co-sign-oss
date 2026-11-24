/**
 * Account Settings Page
 * Profile + organization management
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  FiUser,
  FiMail,
  FiLock,
  FiBriefcase,
  FiShield,
  FiLogOut,
  FiSave,
} from 'react-icons/fi';
import AppLayout from '../../components/layout/AppLayout';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

export default function Settings() {
  const t = useTranslations();
  const router = useRouter();
  const locale = router.query?.locale || 'en';

  const { user, orgId, orgRole, loading: authLoading, signOut } = useAuth({
    redirectTo: '/login',
  });

  // Profile
  const [fullName, setFullName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Org
  const [orgName, setOrgName] = useState('');
  const [orgLoading, setOrgLoading] = useState(true);
  const [savingOrg, setSavingOrg] = useState(false);

  const isAdmin = orgRole === 'admin' || orgRole === 'owner';

  useEffect(() => {
    if (user?.user_metadata?.full_name) {
      setFullName(user.user_metadata.full_name);
    } else {
      setFullName('');
    }
  }, [user?.user_metadata?.full_name]);

  useEffect(() => {
    const loadOrg = async () => {
      if (!orgId) {
        setOrgLoading(false);
        return;
      }
      setOrgLoading(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .single();

      if (!error && data) {
        setOrgName(data.name || '');
      }
      setOrgLoading(false);
    };
    loadOrg();
  }, [orgId]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim() },
      });
      if (error) {
        toast.error(error.message || 'Failed to update profile');
      } else {
        toast.success('Profile updated');
      }
    } catch (err) {
      toast.error('Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (changingPassword) return;
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        toast.error(error.message || 'Failed to change password');
      } else {
        toast.success('Password changed');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      toast.error('Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSaveOrg = async (e) => {
    e.preventDefault();
    if (savingOrg || !isAdmin || !orgId) return;
    if (!orgName.trim()) {
      toast.error('Organization name cannot be empty');
      return;
    }
    setSavingOrg(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/account/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ orgId, name: orgName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error || 'Failed to update organization');
      } else {
        toast.success('Organization updated');
        setOrgName(json.name || orgName.trim());
      }
    } catch (err) {
      toast.error('Failed to update organization');
    } finally {
      setSavingOrg(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const roleLabel = orgRole ? orgRole.charAt(0).toUpperCase() + orgRole.slice(1) : '—';

  return (
    <>
      <Head>
        <title>Settings — Cô Sign</title>
      </Head>

      <AppLayout locale={locale} onSignOut={signOut} maxWidth="max-w-3xl">
          <div className="mb-8">
            <h1 className="text-2xl font-display font-extrabold text-slateish-900">
              Settings
            </h1>
            <p className="text-sm text-slateish-500 mt-1">
              Manage your profile and organization.
            </p>
          </div>

          {/* Profile */}
          <section className="bg-white border border-slateish-100 rounded-2xl p-6 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5">
              <FiUser className="w-5 h-5 text-brand-600" />
              <h2 className="text-lg font-semibold text-slateish-900">Profile</h2>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-slateish-400 w-4 h-4" />
                  <input
                    type="email"
                    value={user.email || ''}
                    disabled
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slateish-200 bg-slateish-50 text-slateish-600 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                  Full name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2.5 rounded-lg border border-slateish-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  <FiSave className="w-4 h-4" />
                  {savingProfile ? 'Saving...' : 'Save profile'}
                </button>
              </div>
            </form>
          </section>

          {/* Password */}
          <section className="bg-white border border-slateish-100 rounded-2xl p-6 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5">
              <FiLock className="w-5 h-5 text-brand-600" />
              <h2 className="text-lg font-semibold text-slateish-900">Password</h2>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                  New password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full px-4 py-2.5 rounded-lg border border-slateish-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-4 py-2.5 rounded-lg border border-slateish-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  autoComplete="new-password"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={changingPassword || !newPassword || !confirmPassword}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  <FiLock className="w-4 h-4" />
                  {changingPassword ? 'Changing...' : 'Change password'}
                </button>
              </div>
            </form>
          </section>

          {/* Organization */}
          <section className="bg-white border border-slateish-100 rounded-2xl p-6 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5">
              <FiBriefcase className="w-5 h-5 text-brand-600" />
              <h2 className="text-lg font-semibold text-slateish-900">Organization</h2>
            </div>

            {!orgId ? (
              <p className="text-sm text-slateish-500">
                {orgLoading ? 'Loading…' : 'No organization found.'}
              </p>
            ) : (
              <form onSubmit={handleSaveOrg} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                    Organization name
                  </label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    disabled={!isAdmin || orgLoading}
                    className="w-full px-4 py-2.5 rounded-lg border border-slateish-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-slateish-50 disabled:text-slateish-600"
                  />
                  {!isAdmin && (
                    <p className="mt-1.5 text-xs text-slateish-500">
                      Only admins can rename the organization.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slateish-700 mb-1.5">
                      Your role
                    </label>
                    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slateish-200 bg-slateish-50 text-sm text-slateish-700">
                      <FiShield className="w-4 h-4 text-brand-600" />
                      <span>{roleLabel}</span>
                    </div>
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingOrg || orgLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
                    >
                      <FiSave className="w-4 h-4" />
                      {savingOrg ? 'Saving...' : 'Save organization'}
                    </button>
                  </div>
                )}
              </form>
            )}
          </section>

          {/* Sign out */}
          <section className="bg-white border border-slateish-100 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-slateish-900">Sign out</h2>
                <p className="text-sm text-slateish-500 mt-0.5">
                  End your current session on this device.
                </p>
              </div>
              <button
                onClick={signOut}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slateish-200 text-sm font-medium text-slateish-700 hover:border-brand-300 hover:bg-brand-50 transition-colors"
              >
                <FiLogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </section>
      </AppLayout>
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
