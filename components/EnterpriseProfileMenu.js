import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { FiHelpCircle, FiLogOut, FiSettings, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabaseClient';

const initialsFrom = (value) => {
  if (!value) return '—';
  const parts = value
    .replace(/[^a-zA-Z0-9@\s._-]/g, '')
    .split(/\s|@|\./)
    .filter(Boolean);
  if (parts.length === 0) return '—';
  const first = parts[0][0] || '';
  const second = parts[1]?.[0] || '';
  return `${first}${second}`.toUpperCase();
};

export default function EnterpriseProfileMenu({ user }) {
  const router = useRouter();
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (event) => {
      if (!menuRef.current || menuRef.current.contains(event.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  const openSettings = () => {
    setDisplayName(user?.user_metadata?.full_name || '');
    setSettingsOpen(true);
    setMenuOpen(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success('Signed out');
    router.push('/enterprise/login');
  };

  const handleSave = async () => {
    const name = displayName.trim();
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: name },
      });
      if (error) throw error;
      toast.success('Profile updated');
      setSettingsOpen(false);
    } catch (err) {
      toast.error('Could not update profile');
    } finally {
      setSaving(false);
    }
  };

  const initials = initialsFrom(user?.user_metadata?.full_name || user?.email || 'User');

  return (
    <div className="epm-root" ref={menuRef}>
      <button className="epm-avatar" onClick={() => setMenuOpen((prev) => !prev)}>
        {initials}
      </button>

      {menuOpen && (
        <div className="epm-dropdown">
          <div className="epm-meta">
            <div className="epm-name">{user?.user_metadata?.full_name || 'Account'}</div>
            <div className="epm-email">{user?.email || '—'}</div>
          </div>
          <button className="epm-item" onClick={openSettings}>
            <FiSettings /> Account settings
          </button>
          <button
            className="epm-item"
            onClick={() => {
              setMenuOpen(false);
              window.dispatchEvent(new CustomEvent('cosign:show-onboarding'));
            }}
          >
            <FiHelpCircle /> Getting started guide
          </button>
          <button className="epm-item danger" onClick={handleLogout}>
            <FiLogOut /> Log out
          </button>
        </div>
      )}

      {settingsOpen && (
        <div className="epm-modal-backdrop">
          <div className="epm-modal">
            <div className="epm-modal-header">
              <div>
                <div className="epm-modal-title">Account settings</div>
                <div className="epm-modal-subtitle">Update your display name.</div>
              </div>
              <button className="epm-close" onClick={() => setSettingsOpen(false)}>
                <FiX />
              </button>
            </div>
            <div className="epm-modal-body">
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label>
                Email
                <input value={user?.email || ''} disabled />
              </label>
            </div>
            <div className="epm-modal-actions">
              <button className="epm-btn ghost" onClick={() => setSettingsOpen(false)}>
                Cancel
              </button>
              <button className="epm-btn primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .epm-root { position: relative; }
        .epm-avatar {
          width: 38px; height: 38px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--brand-200, #c2caf0), var(--brand-400, #7782da));
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700;
          color: var(--brand-900, #262a5c);
          cursor: pointer; border: none;
          transition: box-shadow .2s;
        }
        .epm-avatar:hover {
          box-shadow: 0 0 0 3px rgba(84,95,203, .2);
        }
        .epm-dropdown {
          position: absolute; right: 0; top: 46px;
          min-width: 220px; background: #fff;
          border: 1px solid var(--slateish-200, #dde3e7);
          border-radius: 14px;
          box-shadow: 0 12px 32px rgba(0,0,0,.12);
          padding: 10px; z-index: 60;
        }
        .epm-meta {
          padding: 6px 8px 10px;
          border-bottom: 1px solid var(--slateish-100, #eef1f3);
          margin-bottom: 6px;
        }
        .epm-name {
          font-size: 13px; font-weight: 700;
          color: var(--slateish-900, #1c2226);
        }
        .epm-email {
          font-size: 11px;
          color: var(--slateish-400, #9aa7b0);
          margin-top: 2px;
        }
        .epm-item {
          width: 100%; display: flex;
          align-items: center; gap: 8px;
          padding: 8px 10px; border: none;
          background: none; font-size: 12px;
          font-weight: 600;
          color: var(--slateish-700, #3f4950);
          cursor: pointer; border-radius: 8px;
          font-family: inherit;
        }
        .epm-item:hover { background: var(--slateish-50, #f7f9fa); }
        .epm-item.danger { color: var(--red-500, #ef4444); }
        .epm-item.danger:hover { background: var(--red-50, #fef2f2); }
        .epm-modal-backdrop {
          position: fixed; inset: 0;
          background: rgba(28, 34, 38, 0.4);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          z-index: 80;
        }
        .epm-modal {
          width: 100%; max-width: 420px;
          background: #fff; border-radius: 20px;
          border: 1px solid var(--slateish-200, #dde3e7);
          box-shadow: 0 20px 60px rgba(0,0,0,.15);
          overflow: hidden;
        }
        .epm-modal-header {
          display: flex; align-items: flex-start;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid var(--slateish-100, #eef1f3);
        }
        .epm-modal-title {
          font-size: 16px; font-weight: 800;
          color: var(--slateish-900, #1c2226);
        }
        .epm-modal-subtitle {
          font-size: 12px;
          color: var(--slateish-500, #6f7b84);
          margin-top: 4px;
        }
        .epm-close {
          border: none; background: none;
          cursor: pointer;
          color: var(--slateish-400, #9aa7b0);
        }
        .epm-modal-body {
          padding: 18px 20px; display: grid; gap: 14px;
        }
        .epm-modal-body label {
          display: grid; gap: 6px;
          font-size: 12px; font-weight: 600;
          color: var(--slateish-600, #556068);
        }
        .epm-modal-body input {
          border: 1px solid var(--slateish-200, #dde3e7);
          border-radius: 12px;
          padding: 10px 14px;
          font-size: 13px;
          color: var(--slateish-800, #2b3338);
          font-family: inherit;
          transition: border-color .2s;
        }
        .epm-modal-body input:focus {
          outline: none;
          border-color: var(--brand-400, #7782da);
          box-shadow: 0 0 0 3px rgba(84,95,203, .1);
        }
        .epm-modal-body input:disabled {
          background: var(--slateish-50, #f7f9fa);
          color: var(--slateish-400, #9aa7b0);
        }
        .epm-modal-actions {
          display: flex; justify-content: flex-end;
          gap: 8px; padding: 14px 20px;
          border-top: 1px solid var(--slateish-100, #eef1f3);
          background: var(--slateish-50, #f7f9fa);
        }
        .epm-btn {
          border: none; border-radius: 999px;
          padding: 8px 18px;
          font-size: 13px; font-weight: 700;
          cursor: pointer; font-family: inherit;
        }
        .epm-btn.ghost {
          background: #fff;
          border: 1px solid var(--slateish-200, #dde3e7);
          color: var(--slateish-600, #556068);
        }
        .epm-btn.primary {
          background: var(--brand-600, #4344b3);
          color: #fff;
        }
        .epm-btn.primary:hover {
          background: var(--brand-700, #383a93);
        }
        .epm-btn.primary:disabled { opacity: .6; cursor: default; }
      `}</style>
    </div>
  );
}
