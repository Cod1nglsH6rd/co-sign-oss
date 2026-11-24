/**
 * EnterpriseLayout
 * Shared layout for all enterprise pages.
 * Uses the Co-Sign brand design language: teal palette, Plus Jakarta Sans,
 * Fraunces display font, glass-morphism, soft shadows, rounded corners.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  FiCheck, FiChevronDown, FiFileText, FiLink, FiShield,
} from 'react-icons/fi';
import EnterpriseProfileMenu from '../EnterpriseProfileMenu';
import OnboardingGuide from './OnboardingGuide';
import { useIsOwner } from '../../hooks/useIsOwner';
import { useInvitePasswordGate } from '../../hooks/useInvitePasswordGate';

const formatNumber = (value) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(value);
};

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

export default function EnterpriseLayout({
  children,
  user,
  orgName = 'Enterprise',
  staffCount = 0,
  activePage = '',
  pageTitle = '',
  pageSubtitle = '',
  topbarActions = null,
  counts = {},
  memberships = [],
  onSwitchOrg = null,
}) {
  const router = useRouter();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef(null);
  const canSwitchOrg = Array.isArray(memberships) && memberships.length > 1 && typeof onSwitchOrg === 'function';
  const navOrgInitials = initialsFrom(orgName);

  useEffect(() => {
    if (!orgMenuOpen) return undefined;
    const handler = (e) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target)) setOrgMenuOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [orgMenuOpen]);

  // Someone back from an invite link who has not chosen a password yet is
  // sent to /enterprise/login, which shows the password form.
  useInvitePasswordGate(user);
  const isOwner = useIsOwner(user) === true;

  // The main path only. Dashboard, Recipients and Templates still open by URL.
  const navItems = [
    {
      section: 'Documents',
      items: [
        { key: 'documents', label: 'All Documents', icon: <FiFileText size={15} />, href: '/enterprise/documents', count: counts.documents },
        { key: 'send-links', label: 'Send Links', icon: <FiLink size={15} />, href: '/enterprise/send-links' },
        ...(isOwner ? [{ key: 'owner', label: 'Owner Usage', icon: <FiShield size={15} />, href: '/enterprise/owner' }] : []),
      ],
    },
  ];

  return (
    <>
      <OnboardingGuide />
      <div className="ent-page">
        <aside className="ent-sidebar">
          <Link className="ent-sidebar-logo" href="/enterprise">
            <div className="ent-sidebar-logo-icon">
              <img src="/logo/cosign-logo.png" alt="Co Sign" style={{ width: 22, height: 22, objectFit: 'contain' }} />
            </div>
            <span className="ent-sidebar-logo-text">Co Sign</span>
            <span className="ent-sidebar-logo-badge">ENT</span>
          </Link>
          <nav className="ent-sidebar-nav">
            {navItems.map((section) => (
              <div className="ent-sidebar-section" key={section.section}>
                <div className="ent-sidebar-section-label">{section.section}</div>
                {section.items.map((item) => (
                  <Link
                    key={item.key}
                    className={`ent-sidebar-item${activePage === item.key ? ' active' : ''}`}
                    href={item.href}
                  >
                    <span className="ent-sidebar-item-icon">{item.icon}</span>
                    {item.label}
                    {item.count !== undefined && (
                      <span className="ent-sidebar-count">{formatNumber(item.count)}</span>
                    )}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="ent-sidebar-footer" ref={orgMenuRef}>
            {canSwitchOrg && orgMenuOpen && (
              <div className="ent-org-switch-menu">
                {memberships.map((m) => (
                  <button
                    key={m.orgId}
                    type="button"
                    className={`ent-org-switch-item${m.name === orgName ? ' active' : ''}`}
                    onClick={() => { onSwitchOrg(m.orgId); setOrgMenuOpen(false); }}
                  >
                    <div className="ent-org-switch-avatar">{initialsFrom(m.name)}</div>
                    <span className="ent-org-switch-name">{m.name}</span>
                    {m.name === orgName && <FiCheck size={14} />}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className={`ent-sidebar-org-pill${canSwitchOrg ? ' switchable' : ''}`}
              onClick={() => canSwitchOrg && setOrgMenuOpen((v) => !v)}
              aria-haspopup={canSwitchOrg ? 'menu' : undefined}
            >
              <div className="ent-sidebar-org-avatar">{navOrgInitials}</div>
              <div className="ent-sidebar-org-meta">
                <h4>{orgName}</h4>
                <p>Enterprise · {formatNumber(staffCount)} seats</p>
              </div>
              {canSwitchOrg && <FiChevronDown size={15} className="ent-sidebar-org-chevron" />}
            </button>
          </div>
        </aside>

        <div className="ent-main">
          <header className="ent-topbar">
            <div className="ent-topbar-breadcrumb">
              <span>{orgName}</span>
              <span className="ent-topbar-sep">›</span>
              <span className="ent-topbar-current">{pageTitle}</span>
            </div>
            <div className="ent-topbar-spacer" />
            <div className="ent-topbar-actions">
              {topbarActions}
              <EnterpriseProfileMenu user={user} />
            </div>
          </header>

          <div className="ent-content">
            {(pageTitle || pageSubtitle) && (
              <div className="ent-page-header">
                <div>
                  {pageTitle && <h1>{pageTitle}</h1>}
                  {pageSubtitle && <p>{pageSubtitle}</p>}
                </div>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>

      <style jsx global>{`
        /* ==============================
           CO-SIGN ENTERPRISE DESIGN SYSTEM
           Based on the Co-Sign landing page
           ============================== */

        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
          /* Brand Indigo — enterprise console accent (PRD §5.3).
             Distinct from the recipient/personal teal so staff always know
             they're on the admin side. Overrides the teal defaults from
             styles/globals.css; only mounts on enterprise pages, so it also
             carries every Tailwind brand-* utility on those pages to indigo. */
          --brand-50: #eef1fb;
          --brand-100: #dfe4f7;
          --brand-200: #c2caf0;
          --brand-300: #9ba6e6;
          --brand-400: #7782da;
          --brand-500: #545fcb;
          --brand-600: #4344b3;
          --brand-700: #383a93;
          --brand-800: #2e3175;
          --brand-900: #262a5c;

          /* Slateish Neutrals */
          --slateish-50: #f7f9fa;
          --slateish-100: #eef1f3;
          --slateish-200: #dde3e7;
          --slateish-300: #c6d0d6;
          --slateish-400: #9aa7b0;
          --slateish-500: #6f7b84;
          --slateish-600: #556068;
          --slateish-700: #3f4950;
          --slateish-800: #2b3338;
          --slateish-900: #1c2226;

          /* Status Colors */
          --emerald-50: #ecfdf5;
          --emerald-100: #d1fae5;
          --emerald-600: #059669;
          --emerald-700: #047857;
          --amber-50: #fffbeb;
          --amber-500: #f59e0b;
          --amber-600: #d97706;
          --red-50: #fef2f2;
          --red-500: #ef4444;
          --blue-50: #eff6ff;
          --blue-600: #2563eb;

          /* Radius */
          --r-sm: 10px;
          --r-md: 14px;
          --r-lg: 20px;
          --r-xl: 28px;
          --r-full: 9999px;
        }

        body {
          font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
          color: var(--slateish-800);
          background: var(--slateish-50);
          -webkit-font-smoothing: antialiased;
          min-height: 100vh;
        }

        /* Indeterminate progress bar for documents still being prepared/finalized */
        .ent-prep-bar {
          margin-top: 6px; width: 120px; height: 3px; border-radius: 999px;
          background: var(--brand-100); overflow: hidden;
        }
        .ent-prep-bar-fill {
          width: 40%; height: 100%; border-radius: 999px;
          background: linear-gradient(90deg, var(--brand-400), var(--brand-600));
          animation: entPrepSlide 1.3s ease-in-out infinite;
        }
        @keyframes entPrepSlide {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(310%); }
        }

        /* ===== PAGE LAYOUT ===== */
        .ent-page { display: flex; min-height: 100vh; }

        /* ===== SIDEBAR ===== */
        .ent-sidebar {
          width: 256px;
          background: var(--brand-900);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          position: fixed;
          top: 0; left: 0; bottom: 0;
          z-index: 50;
        }
        .ent-sidebar-logo {
          padding: 24px 20px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid rgba(255,255,255,.08);
          text-decoration: none;
        }
        .ent-sidebar-logo-icon {
          width: 34px; height: 34px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--brand-600), var(--brand-500));
          border: 1px solid rgba(255,255,255,.12);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
        }
        .ent-sidebar-logo-text {
          color: #fff; font-weight: 800; font-size: 17px;
          letter-spacing: -.3px;
        }
        .ent-sidebar-logo-badge {
          padding: 2px 7px; border-radius: 6px;
          background: var(--brand-400);
          color: #fff; font-size: 9px; font-weight: 800;
          text-transform: uppercase; letter-spacing: .5px;
        }
        .ent-sidebar-nav {
          flex: 1; padding: 20px 14px; overflow-y: auto;
        }
        .ent-sidebar-section { margin-bottom: 28px; }
        .ent-sidebar-section-label {
          font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 1.2px;
          color: rgba(255,255,255,.22);
          padding: 0 12px; margin-bottom: 8px;
        }
        .ent-sidebar-item {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: var(--r-sm);
          text-decoration: none;
          color: rgba(255,255,255,.5);
          font-size: 13px; font-weight: 500;
          transition: all .2s; cursor: pointer;
        }
        .ent-sidebar-item:hover {
          background: rgba(255,255,255,.07);
          color: rgba(255,255,255,.85);
        }
        .ent-sidebar-item.active {
          background: rgba(255,255,255,.1);
          color: #fff; font-weight: 600;
        }
        .ent-sidebar-item.active .ent-sidebar-item-icon {
          filter: brightness(1.3);
        }
        .ent-sidebar-item-icon {
          width: 18px; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .ent-sidebar-count {
          margin-left: auto;
          padding: 2px 8px; border-radius: var(--r-full);
          background: rgba(255,255,255,.08);
          font-size: 10px; font-weight: 700;
          color: rgba(255,255,255,.5);
        }
        .ent-sidebar-item.active .ent-sidebar-count {
          background: var(--brand-500);
          color: #fff;
        }
        .ent-sidebar-footer {
          padding: 16px 14px;
          border-top: 1px solid rgba(255,255,255,.08);
          position: relative;
        }
        .ent-sidebar-org-pill {
          width: 100%; text-align: left;
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; border-radius: var(--r-md);
          background: rgba(255,255,255,.05);
          border: 1px solid rgba(255,255,255,.08);
          font-family: inherit;
        }
        .ent-sidebar-org-pill.switchable { cursor: pointer; transition: background .2s; }
        .ent-sidebar-org-pill.switchable:hover { background: rgba(255,255,255,.09); }
        .ent-sidebar-org-meta { min-width: 0; flex: 1; }
        .ent-sidebar-org-chevron { color: rgba(255,255,255,.4); flex-shrink: 0; }
        .ent-sidebar-org-avatar {
          width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
          background: linear-gradient(135deg, var(--brand-500), var(--brand-300));
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; color: #fff;
        }
        .ent-sidebar-org-pill h4 {
          font-size: 12px; font-weight: 600; color: #fff;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ent-sidebar-org-pill p {
          font-size: 10px; color: rgba(255,255,255,.35);
        }
        .ent-org-switch-menu {
          position: absolute;
          left: 14px; right: 14px; bottom: 76px;
          background: var(--brand-800);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: var(--r-md);
          padding: 6px; z-index: 60;
          box-shadow: 0 -8px 30px rgba(0,0,0,.3);
          max-height: 280px; overflow-y: auto;
        }
        .ent-org-switch-item {
          width: 100%; display: flex; align-items: center; gap: 10px;
          padding: 9px 10px; border-radius: 8px;
          background: none; border: none; cursor: pointer; font-family: inherit;
          color: rgba(255,255,255,.7); font-size: 13px; font-weight: 500;
        }
        .ent-org-switch-item:hover { background: rgba(255,255,255,.08); color: #fff; }
        .ent-org-switch-item.active { color: #fff; }
        .ent-org-switch-avatar {
          width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
          background: linear-gradient(135deg, var(--brand-500), var(--brand-300));
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700; color: #fff;
        }
        .ent-org-switch-name { flex: 1; min-width: 0; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* ===== MAIN ===== */
        .ent-main {
          margin-left: 256px;
          flex: 1; display: flex; flex-direction: column;
          /* Flex items default to min-width:auto and won't shrink below their
             content's intrinsic width; a wide child (chart/table) then pushes
             the whole layout past the viewport. min-width:0 lets it shrink to
             the space left by the fixed sidebar so nothing is clipped. */
          min-width: 0;
        }

        /* ===== TOPBAR (Glass) ===== */
        .ent-topbar {
          height: 64px;
          background: rgba(255,255,255,.82);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-bottom: 1px solid var(--slateish-100);
          display: flex; align-items: center;
          padding: 0 32px; gap: 16px;
          position: sticky; top: 0; z-index: 40;
        }
        .ent-topbar-breadcrumb {
          display: flex; align-items: center; gap: 8px;
          font-size: 14px; color: var(--slateish-400);
        }
        .ent-topbar-sep { color: var(--slateish-300); }
        .ent-topbar-current {
          font-weight: 600; color: var(--slateish-800);
        }
        .ent-topbar-spacer { flex: 1; }
        .ent-topbar-actions {
          display: flex; align-items: center; gap: 10px;
        }

        /* ===== CONTENT ===== */
        .ent-content { padding: 28px 32px; }
        .ent-page-header {
          display: flex; align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 24px;
        }
        .ent-page-header h1 {
          font-size: 26px; font-weight: 800;
          color: var(--slateish-900);
          letter-spacing: -.5px;
        }
        .ent-page-header p {
          font-size: 14px; color: var(--slateish-500);
          margin-top: 4px;
        }

        /* ===== SHARED BUTTONS ===== */
        .ent-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 18px; border-radius: var(--r-full);
          font-size: 13px; font-weight: 600;
          font-family: inherit; cursor: pointer;
          transition: all .2s; border: none;
          text-decoration: none;
        }
        .ent-btn.outline {
          background: #fff;
          border: 1px solid var(--slateish-200);
          color: var(--slateish-600);
        }
        .ent-btn.outline:hover {
          border-color: var(--brand-300);
          color: var(--brand-700);
          background: var(--brand-50);
        }
        .ent-btn.primary {
          background: var(--brand-600);
          color: #fff;
        }
        .ent-btn.primary:hover {
          background: var(--brand-700);
        }
        .ent-btn.ghost {
          background: transparent;
          color: var(--slateish-500);
        }

        /* ===== CARDS ===== */
        .ent-card {
          background: #fff;
          border-radius: var(--r-lg);
          border: 1px solid var(--slateish-100);
          box-shadow: 0 1px 3px rgba(0,0,0,.04);
        }
        .ent-card-header {
          display: flex; align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid var(--slateish-100);
        }
        .ent-card-header h3 {
          font-size: 15px; font-weight: 700;
          color: var(--slateish-900);
        }
        .ent-card-header p {
          font-size: 12px; color: var(--slateish-400);
          margin-top: 2px;
        }
        .ent-card-action {
          padding: 6px 14px; border-radius: var(--r-full);
          font-size: 12px; font-weight: 600;
          color: var(--brand-600);
          background: var(--brand-50);
          border: none; cursor: pointer;
          font-family: inherit;
          transition: background .2s;
        }
        .ent-card-action:hover { background: var(--brand-100); }

        /* ===== STAT CARDS ===== */
        .ent-stat-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px; margin-bottom: 24px;
        }
        .ent-stat-card {
          background: #fff;
          border: 1px solid var(--slateish-100);
          border-radius: var(--r-lg);
          padding: 18px 20px;
          display: flex; align-items: center; gap: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,.04);
        }
        .ent-stat-icon {
          width: 40px; height: 40px;
          border-radius: var(--r-sm);
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; flex-shrink: 0;
        }
        .ent-stat-val {
          font-size: 24px; font-weight: 800;
          color: var(--slateish-900);
          letter-spacing: -.5px; line-height: 1;
        }
        .ent-stat-label {
          font-size: 12px; color: var(--slateish-500);
          margin-top: 2px;
        }

        /* ===== TABLE TOOLBAR ===== */
        .ent-table-toolbar {
          display: flex; gap: 12px;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          border-bottom: 1px solid var(--slateish-100);
        }
        .ent-search-box {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 14px;
          border: 1px solid var(--slateish-200);
          border-radius: var(--r-full);
          min-width: 260px;
          color: var(--slateish-400); font-size: 13px;
          transition: border-color .2s;
        }
        .ent-search-box:focus-within {
          border-color: var(--brand-400);
          box-shadow: 0 0 0 3px rgba(84,95,203,.1);
        }
        .ent-search-box input {
          border: none; outline: none;
          font-size: 13px; width: 100%;
          font-family: inherit;
          color: var(--slateish-700);
          background: transparent;
        }
        .ent-table-filters {
          display: flex; align-items: center; gap: 8px;
        }
        .ent-table-filters select {
          border: 1px solid var(--slateish-200);
          border-radius: var(--r-full);
          padding: 7px 14px;
          font-size: 12px; color: var(--slateish-600);
          background: #fff; font-family: inherit;
        }

        /* ===== BULK ACTIONS ===== */
        .ent-bulk-actions {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 12px; border-radius: var(--r-full);
          background: var(--brand-50);
          border: 1px solid var(--brand-100);
        }
        .ent-bulk-count {
          font-size: 11px; font-weight: 700;
          color: var(--brand-700);
        }
        .ent-bulk-btn {
          padding: 6px 12px; border-radius: var(--r-full);
          border: 1px solid var(--brand-200);
          background: #fff;
          font-size: 11px; font-weight: 700;
          color: var(--brand-700);
          cursor: pointer; font-family: inherit;
        }
        .ent-bulk-btn:hover { background: var(--brand-50); }
        .ent-bulk-btn.ghost {
          background: transparent; border-color: transparent;
          color: var(--slateish-500);
        }

        /* ===== TABLE ===== */
        .ent-table-wrap { overflow: hidden; }
        .ent-table {
          width: 100%; border-collapse: collapse;
        }
        .ent-table th {
          text-align: left; padding: 14px 24px;
          font-size: 11px; text-transform: uppercase;
          letter-spacing: .6px; color: var(--slateish-400);
          background: var(--slateish-50);
          border-bottom: 1px solid var(--slateish-100);
        }
        .ent-table td {
          padding: 14px 24px;
          border-bottom: 1px solid var(--slateish-100);
          vertical-align: middle;
          font-size: 13px; color: var(--slateish-700);
        }
        .ent-table tr:last-child td { border-bottom: none; }
        .ent-table tr:hover td { background: var(--slateish-50); }
        .ent-table tr.clickable { cursor: pointer; }

        /* ===== CLIENT CELL ===== */
        .ent-client-cell {
          display: flex; gap: 10px; align-items: center;
        }
        .ent-client-avatar {
          width: 36px; height: 36px;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; color: #fff;
          background: linear-gradient(135deg, var(--brand-500), var(--brand-300));
        }
        .ent-client-name {
          font-size: 13px; font-weight: 600;
          color: var(--slateish-800);
        }
        .ent-client-sub {
          font-size: 11px; color: var(--slateish-400);
        }

        /* ===== DOC CELL ===== */
        .ent-doc-cell {
          display: flex; align-items: center; gap: 12px;
        }
        .ent-doc-thumb {
          width: 40px; height: 48px;
          border-radius: 12px;
          background: linear-gradient(180deg, var(--brand-50), #fff);
          border: 1px solid var(--slateish-200);
          display: flex; align-items: center; justify-content: center;
          font-size: 18px;
        }
        .ent-doc-title {
          font-size: 13px; font-weight: 700;
          color: var(--slateish-900);
        }
        .ent-doc-meta {
          font-size: 11px; color: var(--slateish-400);
          margin-top: 4px;
        }

        /* ===== BADGES ===== */
        .ent-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px 12px; border-radius: var(--r-full);
          font-size: 11px; font-weight: 700;
          white-space: nowrap;
        }
        .ent-badge.completed { background: var(--emerald-50); color: var(--emerald-700); }
        .ent-badge.in-progress { background: var(--amber-50); color: var(--amber-600); }
        .ent-badge.sent { background: var(--slateish-100); color: var(--slateish-500); }
        .ent-badge.opened { background: var(--blue-50); color: var(--blue-600); }
        .ent-badge.active { background: var(--emerald-50); color: var(--emerald-700); }
        .ent-badge.unused { background: var(--amber-50); color: var(--amber-500); }
        .ent-badge.prepping { background: var(--brand-50); color: var(--brand-600); }
        .ent-badge.ready { background: var(--emerald-50); color: var(--emerald-600); }
        .ent-badge.finalizing { background: var(--blue-50); color: var(--blue-600); }
        .ent-badge.complete { background: var(--slateish-100); color: var(--slateish-600); }
        .ent-badge.pending { background: var(--slateish-100); color: var(--slateish-500); }
        .ent-badge.queued { background: var(--brand-50); color: var(--brand-600); }

        /* ===== PROGRESS ===== */
        .ent-progress-bar {
          width: 90px; height: 6px;
          background: var(--slateish-100);
          border-radius: 4px; overflow: hidden;
        }
        .ent-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--brand-500), var(--brand-400));
          border-radius: 4px;
        }

        /* ===== TAB ROW ===== */
        .ent-tab-row {
          display: flex; gap: 24px;
          padding: 0 20px;
          border-bottom: 1px solid var(--slateish-100);
          overflow-x: auto;
        }
        .ent-tab-item {
          padding: 14px 0 12px;
          font-size: 13px; font-weight: 700;
          color: var(--slateish-400);
          cursor: pointer;
          border-bottom: 2px solid transparent;
          white-space: nowrap;
          transition: color .2s;
        }
        .ent-tab-item:hover { color: var(--slateish-600); }
        .ent-tab-item.active {
          color: var(--brand-700);
          border-bottom-color: var(--brand-500);
        }
        .ent-tab-badge {
          margin-left: 8px;
          padding: 2px 8px; border-radius: var(--r-full);
          font-size: 11px;
          background: var(--brand-50); color: var(--brand-700);
        }
        .ent-tab-badge.warn {
          background: var(--amber-50); color: var(--amber-500);
        }

        /* ===== LIVE INDICATOR ===== */
        .ent-live-pill {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px; color: var(--slateish-500);
          padding: 6px 14px; border-radius: var(--r-full);
          background: rgba(255,255,255,.8);
          backdrop-filter: blur(8px);
          border: 1px solid var(--slateish-200);
        }
        .ent-live-dot {
          width: 8px; height: 8px;
          border-radius: 50%; display: inline-block;
        }
        .ent-live-dot.live { background: #22c55e; }
        .ent-live-dot.offline { background: #f97316; }

        /* ===== TABLE ACTION BUTTON ===== */
        .ent-table-action-btn {
          padding: 6px 14px; border-radius: var(--r-full);
          font-size: 12px; font-weight: 600;
          color: var(--brand-600);
          border: 1px solid var(--brand-100);
          background: var(--brand-50);
          cursor: pointer; font-family: inherit;
          transition: all .2s;
        }
        .ent-table-action-btn:hover {
          background: var(--brand-100);
          border-color: var(--brand-200);
        }

        /* ===== ACTION BUTTONS (Green, Amber, Teal) ===== */
        .ent-act-cell { display: flex; justify-content: flex-end; gap: 8px; }
        .ent-act-btn {
          display: inline-flex; align-items: center; justify-content: center;
          padding: 8px 14px; border-radius: var(--r-full);
          text-decoration: none;
          font-size: 12px; font-weight: 700;
          white-space: nowrap; transition: all .2s;
          border: none; cursor: pointer; font-family: inherit;
        }
        .ent-act-btn.green {
          background: var(--emerald-50); color: var(--emerald-700);
          border: 1px solid var(--emerald-100);
        }
        .ent-act-btn.green:hover { background: var(--emerald-100); }
        .ent-act-btn.amber {
          background: var(--amber-50); color: var(--amber-600);
          border: 1px solid rgba(245,158,11,.15);
        }
        .ent-act-btn.amber:hover { background: rgba(245,158,11,.12); }
        .ent-act-btn.teal {
          background: var(--brand-50); color: var(--brand-700);
          border: 1px solid var(--brand-100);
        }
        .ent-act-btn.teal:hover { background: var(--brand-100); }

        /* ===== MODAL ===== */
        .ent-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(12, 18, 24, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 90;
          padding: 20px;
        }
        .ent-modal {
          width: 100%;
          max-width: 480px;
          background: #fff;
          border-radius: var(--r-lg);
          border: 1px solid var(--slateish-200);
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
          overflow: hidden;
        }
        .ent-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 16px 18px;
          border-bottom: 1px solid var(--slateish-100);
        }
        .ent-modal-title {
          font-size: 15px;
          font-weight: 800;
          color: var(--slateish-900);
        }
        .ent-modal-subtitle {
          font-size: 12px;
          color: var(--slateish-500);
          margin-top: 4px;
        }
        .ent-modal-close {
          border: none;
          background: none;
          color: var(--slateish-400);
          font-size: 18px;
          cursor: pointer;
        }
        .ent-modal-body {
          padding: 16px 18px;
        }
        .ent-modal.pdf {
          max-width: min(960px, 92vw);
          height: min(80vh, 720px);
          display: flex;
          flex-direction: column;
        }
        .ent-modal-body.pdf {
          flex: 1;
          padding: 0;
        }
        .ent-modal-iframe {
          width: 100%;
          height: 100%;
          border: none;
        }
        .ent-modal-label {
          display: grid;
          gap: 8px;
          font-size: 12px;
          color: var(--slateish-600);
          font-weight: 600;
        }
        .ent-modal-label input {
          border: 1px solid var(--slateish-200);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 13px;
          font-family: inherit;
          color: var(--slateish-800);
        }
        .ent-modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 18px;
          border-top: 1px solid var(--slateish-100);
          background: var(--slateish-50);
        }

        /* ===== DRAWER ===== */
        .ent-drawer-backdrop {
          position: fixed; inset: 0;
          background: rgba(28, 34, 38, 0.4);
          backdrop-filter: blur(4px);
          display: flex; justify-content: flex-end;
          z-index: 80;
        }
        .ent-drawer {
          width: min(540px, 100%);
          background: #fff; height: 100%;
          display: flex; flex-direction: column;
          box-shadow: -16px 0 40px rgba(28, 34, 38, 0.1);
          border-left: 1px solid var(--slateish-100);
        }
        .ent-drawer-header {
          padding: 20px 24px;
          border-bottom: 1px solid var(--slateish-100);
          display: flex; align-items: center;
          justify-content: space-between;
        }
        .ent-drawer-header h3 {
          font-size: 18px; font-weight: 700;
          color: var(--slateish-900);
        }
        .ent-drawer-header p {
          font-size: 12px; color: var(--slateish-500);
          margin-top: 4px;
        }
        .ent-drawer-close {
          border: none;
          background: var(--slateish-100);
          width: 34px; height: 34px;
          border-radius: 50%; cursor: pointer;
          font-size: 14px; color: var(--slateish-600);
          display: flex; align-items: center; justify-content: center;
          transition: background .2s;
        }
        .ent-drawer-close:hover { background: var(--slateish-200); }
        .ent-drawer-body {
          padding: 16px 24px 24px;
          overflow-y: auto;
          display: flex; flex-direction: column; gap: 16px;
        }
        .ent-drawer-stats {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
        }
        .ent-drawer-stats > div {
          background: var(--slateish-50);
          border-radius: var(--r-md); padding: 14px;
          border: 1px solid var(--slateish-100);
        }
        .ent-drawer-stats span {
          display: block; font-size: 11px;
          color: var(--slateish-500); margin-bottom: 6px;
        }
        .ent-drawer-stats strong {
          font-size: 16px; color: var(--slateish-900);
        }
        .ent-drawer-table {
          display: flex; flex-direction: column; gap: 10px;
        }
        .ent-drawer-table-head {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          font-size: 11px; text-transform: uppercase;
          letter-spacing: .5px; color: var(--slateish-400);
          padding: 0 4px;
        }
        .ent-drawer-row {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          align-items: center; gap: 12px;
          padding: 14px;
          border-radius: var(--r-md);
          border: 1px solid var(--slateish-100);
          transition: background .2s;
        }
        .ent-drawer-row:hover { background: var(--slateish-50); }
        .ent-drawer-doc strong {
          display: block; font-size: 13px;
          color: var(--slateish-800);
        }
        .ent-drawer-doc span {
          font-size: 11px; color: var(--slateish-400);
        }
        .ent-drawer-progress {
          display: flex; align-items: center; gap: 8px;
          font-size: 11px; color: var(--slateish-500);
        }
        .ent-drawer-activity {
          font-size: 12px; color: var(--slateish-500);
        }

        /* ===== LOADING ===== */
        .ent-loading-screen {
          min-height: 100vh;
          display: flex; align-items: center; justify-content: center;
          background: var(--slateish-50);
        }
        .ent-loading-spinner {
          width: 32px; height: 32px;
          border-radius: 9999px;
          border: 3px solid var(--brand-200);
          border-top-color: var(--brand-600);
          animation: ent-spin .9s linear infinite;
        }
        @keyframes ent-spin { to { transform: rotate(360deg); } }

        /* ===== RESPONSIVE ===== */
        @media (max-width: 1200px) {
          .ent-stat-row { grid-template-columns: repeat(2, 1fr); }
          .ent-table-toolbar { flex-direction: column; align-items: flex-start; }
        }
        @media (max-width: 900px) {
          .ent-sidebar { position: relative; width: 100%; height: auto; }
          .ent-main { margin-left: 0; }
          .ent-page { flex-direction: column; }
          .ent-topbar { padding: 0 20px; }
          .ent-content { padding: 20px; }
          .ent-drawer { width: 100%; }
          .ent-drawer-stats { grid-template-columns: 1fr; }
          .ent-drawer-table-head, .ent-drawer-row { grid-template-columns: 1fr; }
          .ent-stat-row { grid-template-columns: 1fr; }
        }
        @media (max-width: 760px) {
          .ent-content { padding: 18px; }
          .ent-topbar { padding: 0 18px; }
          .ent-act-cell { flex-direction: column; align-items: stretch; }
          .ent-table { display: block; overflow-x: auto; }
        }
      `}</style>
    </>
  );
}
