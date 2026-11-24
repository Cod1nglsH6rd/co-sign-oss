import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import EnterpriseLayout from '../../components/enterprise/EnterpriseLayout';
import { useIsOwner } from '../../hooks/useIsOwner';

const formatNumber = (value) => new Intl.NumberFormat('en-US').format(value || 0);

const RESTRICTED = 'This dashboard is restricted to owner accounts.';

function MetricCard({ label, value, note }) {
  return (
    <div className="owner-card">
      <p className="owner-label">{label}</p>
      <h3 className="owner-value">{value}</h3>
      {note && <p className="owner-note">{note}</p>}
    </div>
  );
}

export default function OwnerDashboard() {
  const { user, orgId, memberships, switchOrg } = useAuth({ redirectTo: '/enterprise/login' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteError, setInviteError] = useState('');
  // The one-time link the server returns when the invitation mail did not go out.
  const [inviteLink, setInviteLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // null until /api/admin/me answers for this user; the page stays on its loading state.
  const isOwner = useIsOwner(user);

  const loadUsage = useCallback(async () => {
    if (!user?.id || isOwner === null) return;
    if (!isOwner) {
      setError(RESTRICTED);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/admin/usage', {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Failed to load owner usage');
      }

      setData(json);
    } catch (err) {
      setError(err.message || 'Failed to load owner usage');
    } finally {
      setLoading(false);
    }
  }, [isOwner, user?.id]);

  const loadMembers = useCallback(async () => {
    if (!user?.id || !isOwner) {
      setMembersLoading(false);
      return;
    }

    setMembersLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/admin/users', {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Failed to load members');
      }
      setMembers(json?.members || []);
    } catch (err) {
      setInviteError(err.message || 'Failed to load members');
    } finally {
      setMembersLoading(false);
    }
  }, [isOwner, user?.id]);

  useEffect(() => {
    loadUsage();
    loadMembers();
  }, [loadUsage, loadMembers]);

  const handleInviteUser = async (event) => {
    event.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviteLoading(true);
    setInviteMessage('');
    setInviteError('');
    setInviteLink(null);
    setLinkCopied(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Failed to add user');
      }

      setInviteEmail('');
      setInviteRole('member');
      if (json?.inviteLink) {
        setInviteLink(json.inviteLink);
        const why = { provider_error: 'sending failed', no_sender: 'no sender address is set' }[json.mailReason] || 'mail is off';
        setInviteMessage(json?.invited
          ? `Membership added. The invitation mail was not sent (${why}): send this link to ${json?.user?.email} so they can set up their account.`
          : `This is a new sign-in link for ${json?.user?.email}, who has not chosen a password yet. The mail was not sent (${why}): send them this link; they will be asked to choose a password.`);
      } else {
        setInviteMessage(
          json?.invited
            ? `Invite sent to ${json?.user?.email}. Membership added.`
            : `${json?.user?.email} added to your organization.`,
        );
      }
      await loadMembers();
    } catch (err) {
      setInviteError(err.message || 'Failed to add user');
    } finally {
      setInviteLoading(false);
    }
  };

  // navigator.clipboard exists only in a secure context (https, or
  // localhost): at a plain-HTTP site address, such as a LAN address with
  // COSIGN_BIND=0.0.0.0, it is missing, so the link is copied with the copy
  // command instead, as Send Links does.
  const handleCopyLink = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        const temp = document.createElement('textarea');
        temp.value = inviteLink;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        let copied = false;
        try {
          temp.focus();
          temp.select();
          copied = document.execCommand('copy');
        } finally {
          document.body.removeChild(temp);
        }
        if (!copied) throw new Error('The copy command was refused');
      }
      setLinkCopied(true);
    } catch {
      setInviteError('Could not copy the link: select it and copy it by hand.');
    }
  };

  const cards = data?.metrics || {
    organizations: 0,
    activeMembers: 0,
    documents: 0,
    processedDocuments: 0,
    sessions: 0,
    completedSessions: 0,
    completionRate: 0,
    betaSignups: 0,
  };

  return (
    <>
      <Head>
        <title>Owner Usage Dashboard - Co Sign</title>
      </Head>

      <EnterpriseLayout
        memberships={memberships}
        onSwitchOrg={switchOrg}
        user={user}
        orgName="Co Sign Owner"
        staffCount={0}
        activePage="owner"
        pageTitle="Owner Usage"
        pageSubtitle="Private platform analytics for deployment readiness."
        counts={{}}
      >
        {loading || isOwner === null ? (
          <div className="owner-loading">Loading usage metrics...</div>
        ) : error || !isOwner ? (
          <div className="owner-error">{error || RESTRICTED}</div>
        ) : (
          <div className="owner-wrap">
            <div className="owner-grid">
              <MetricCard label="Organizations" value={formatNumber(cards.organizations)} />
              <MetricCard label="Active Members" value={formatNumber(cards.activeMembers)} />
              <MetricCard label="Documents" value={formatNumber(cards.documents)} />
              <MetricCard label="Processed Documents" value={formatNumber(cards.processedDocuments)} />
              <MetricCard label="Sessions" value={formatNumber(cards.sessions)} />
              <MetricCard label="Completed Sessions" value={formatNumber(cards.completedSessions)} />
              <MetricCard label="Completion Rate" value={`${cards.completionRate || 0}%`} />
              <MetricCard label="Beta Signups" value={formatNumber(cards.betaSignups)} />
            </div>

            <div className="owner-trends">
              <div className="owner-card trend">
                <h4>Last 14 Days</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Docs Created</th>
                      <th>Sessions Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.trends?.labels || []).map((label, index) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td>{data?.trends?.docsCreated?.[index] || 0}</td>
                        <td>{data?.trends?.sessionsCompleted?.[index] || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="owner-card meta">
                <h4>Context</h4>
                <p><strong>Viewer:</strong> {data?.owner || user?.email || 'Owner'}</p>
                <p><strong>Generated:</strong> {new Date(data?.generatedAt || Date.now()).toLocaleString('en-US')}</p>
                <p><strong>Enterprise Org:</strong> {orgId || 'N/A (global view)'}</p>
              </div>
            </div>

            <div className="owner-card team">
              <h4>Add User</h4>
              <form className="owner-invite-form" onSubmit={handleInviteUser}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@company.com"
                  required
                />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="submit" disabled={inviteLoading}>
                  {inviteLoading ? 'Adding...' : 'Add User'}
                </button>
              </form>
              {inviteMessage && <p className="owner-success">{inviteMessage}</p>}
              {inviteLink && (
                <div className="owner-invite-link">
                  <input type="text" value={inviteLink} readOnly aria-label="Invite link" onFocus={(e) => e.target.select()} />
                  <button type="button" onClick={handleCopyLink}>{linkCopied ? 'Copied' : 'Copy'}</button>
                </div>
              )}
              {inviteError && <p className="owner-failure">{inviteError}</p>}

              <div className="owner-members">
                <h5>Current Members</h5>
                {membersLoading ? (
                  <p>Loading members...</p>
                ) : members.length === 0 ? (
                  <p>No active members yet.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.id}>
                          <td>{member.email}</td>
                          <td>{member.role}</td>
                          <td>{new Date(member.createdAt).toLocaleDateString('en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </EnterpriseLayout>

      <style jsx>{`
        .owner-wrap { display: grid; gap: 16px; }
        .owner-loading, .owner-error { background: #fff; border: 1px solid var(--slateish-200); border-radius: 14px; padding: 18px; color: var(--slateish-600); }
        .owner-error { border-color: #fecaca; color: #b91c1c; background: #fff7f7; }
        .owner-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .owner-card { background: #fff; border: 1px solid var(--slateish-200); border-radius: 14px; padding: 14px; box-shadow: 0 8px 24px rgba(2,6,23,.04); }
        .owner-label { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--slateish-500); }
        .owner-value { margin-top: 6px; font-size: 28px; color: var(--slateish-900); }
        .owner-note { margin-top: 4px; font-size: 12px; color: var(--slateish-500); }
        .owner-trends { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
        .trend h4, .meta h4 { font-size: 14px; color: var(--slateish-800); margin-bottom: 10px; }
        .trend table { width: 100%; border-collapse: collapse; }
        .trend th, .trend td { text-align: left; font-size: 12px; padding: 8px 6px; border-bottom: 1px solid var(--slateish-100); color: var(--slateish-700); }
        .meta p { font-size: 12px; color: var(--slateish-600); margin-top: 8px; }
        .team h4 { font-size: 14px; color: var(--slateish-800); margin-bottom: 10px; }
        .owner-invite-form { display: grid; grid-template-columns: 2fr 1fr auto; gap: 8px; margin-bottom: 10px; }
        .owner-invite-form input, .owner-invite-form select { border: 1px solid var(--slateish-200); border-radius: 10px; padding: 10px 12px; font-size: 13px; }
        .owner-invite-form button { border: none; border-radius: 10px; padding: 10px 14px; background: var(--brand-600); color: #fff; font-weight: 600; cursor: pointer; }
        .owner-invite-form button:disabled { opacity: .6; cursor: not-allowed; }
        .owner-success { font-size: 12px; color: #15803d; margin-top: 6px; }
        .owner-invite-link { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 6px; }
        .owner-invite-link input, .owner-invite-link button { border: 1px solid var(--slateish-200); border-radius: 10px; padding: 8px 10px; font-size: 12px; background: #fff; }
        .owner-failure { font-size: 12px; color: #b91c1c; margin-top: 6px; }
        .owner-members { margin-top: 14px; }
        .owner-members h5 { font-size: 12px; color: var(--slateish-700); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .4px; }
        .owner-members table { width: 100%; border-collapse: collapse; }
        .owner-members th, .owner-members td { text-align: left; font-size: 12px; padding: 8px 6px; border-bottom: 1px solid var(--slateish-100); color: var(--slateish-700); }
        @media (max-width: 1100px) {
          .owner-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .owner-trends { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .owner-grid { grid-template-columns: 1fr; }
          .owner-invite-form { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}

export async function getServerSideProps() {
  const messages = require('../../locales/en.json');
  return { props: { messages } };
}
