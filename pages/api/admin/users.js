import { requireServiceSupabase } from '../../../lib/supabaseClient';
import { getServerOwnerEmails, isOwnerEmail } from '../../../lib/ownerEmails';
import { effectiveSetting } from '../../../lib/hostSettings';
import { sendMemberInviteEmail } from '../../../lib/email';

const ALLOWED_ROLES = new Set(['admin', 'member']);

// Last resort for the invite link when no site address is set.
function requestHostBaseUrl(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !host.trim()) return null;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' && forwardedProto.trim()
    ? forwardedProto.split(',')[0].trim()
    : (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host.trim()}`;
}

function normalizeRole(role) {
  const safeRole = String(role || 'member').trim().toLowerCase();
  return ALLOWED_ROLES.has(safeRole) ? safeRole : null;
}

async function getAuthedOwner(req, supabase) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing authorization header', status: 401 };
  }

  const jwt = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(jwt);

  if (error || !user) {
    return { error: 'Invalid or expired token', status: 401 };
  }

  if (!isOwnerEmail(user.email, getServerOwnerEmails())) {
    return { error: 'Forbidden', status: 403 };
  }

  return { user };
}

async function getOwnerOrgId(ownerUserId, supabase) {
  const { data: membership, error } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', ownerUserId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !membership?.org_id) {
    return null;
  }

  return membership.org_id;
}

async function findUserByEmail(email, supabase) {
  const target = email.toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(error.message || 'Failed to list users');
    }

    const users = data?.users || [];
    const matched = users.find((u) => (u.email || '').toLowerCase() === target);
    if (matched) return matched;

    if (users.length < perPage) break;
  }

  return null;
}

async function getEmailMapForUserIds(userIds, supabase) {
  const map = {};
  await Promise.all(
    userIds.map(async (id) => {
      if (!id) return;
      const { data } = await supabase.auth.admin.getUserById(id);
      const email = data?.user?.email || null;
      map[id] = email;
    }),
  );
  return map;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = requireServiceSupabase();
    const auth = await getAuthedOwner(req, supabase);
    if (auth.error) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const ownerUser = auth.user;
    const orgId = await getOwnerOrgId(ownerUser.id, supabase);
    if (!orgId) {
      return res.status(400).json({ error: 'Owner account has no active organization' });
    }

    if (req.method === 'GET') {
      const { data: memberships, error } = await supabase
        .from('org_memberships')
        .select('id, user_id, role, status, created_at')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Admin Users] Members query error:', error);
        return res.status(500).json({ error: 'Failed to load members' });
      }

      const rows = memberships || [];
      const emailMap = await getEmailMapForUserIds(
        rows.map((row) => row.user_id),
        supabase,
      );

      const members = rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        email: emailMap[row.user_id] || 'Unknown',
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
      }));

      return res.status(200).json({ orgId, members });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = normalizeRole(req.body?.role);

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!role) {
      return res.status(400).json({ error: 'Role must be admin or member' });
    }

    let targetUser = await findUserByEmail(email, supabase);
    let invited = false;
    let inviteLink = null;

    // NEXT_PUBLIC_APP_URL (env, else the address saved at setup), then the
    // request's Host. Never the Origin header: whoever sends the request
    // chooses it, and the invite email would carry their link.
    const origin = (effectiveSetting('NEXT_PUBLIC_APP_URL', process.env) || requestHostBaseUrl(req) || '')
      .replace(/\/+$/, '');
    const redirectTo = origin ? `${origin}/enterprise/login` : undefined;

    if (!targetUser) {
      // generateLink makes the account and returns the one-time link without
      // mailing it (the auth service at home has no mail server). The link is
      // never logged: only the error's message and status are.
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'invite',
        email,
        ...(redirectTo ? { options: { redirectTo } } : {}),
      });
      inviteLink = linkData?.properties?.action_link || null;

      if (linkError || !inviteLink) {
        console.error('[Admin Users] Invite link error:', linkError?.message || 'no link returned', linkError?.status || '');
        return res.status(500).json({ error: 'Failed to invite user' });
      }

      targetUser = linkData?.user || (await findUserByEmail(email, supabase));
      invited = true;
    }

    if (!targetUser?.id) {
      return res.status(500).json({ error: 'Could not resolve invited user id' });
    }

    // A fresh one-time sign-in link for an existing account, only when both
    // hold: the account still has no password (password_pending, set by the
    // service role at invite), so an account with a password never gets a
    // link made for it by someone else; and it was already an active member
    // of this owner's organisation before this request, so an owner only
    // ever gets a link for a person they had already added. Made before the
    // membership is touched, so a failure changes nothing. Never logged.
    if (!invited && targetUser.app_metadata?.password_pending === true) {
      const { data: existing, error: existingError } = await supabase
        .from('org_memberships')
        .select('id')
        .eq('org_id', orgId)
        .eq('user_id', targetUser.id)
        .eq('status', 'active')
        .maybeSingle();
      if (existingError) {
        console.error('[Admin Users] Membership lookup error:', existingError.message || '');
        return res.status(500).json({ error: 'Failed to check membership' });
      }
      if (existing) {
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
          type: 'magiclink',
          email,
          ...(redirectTo ? { options: { redirectTo } } : {}),
        });
        inviteLink = linkData?.properties?.action_link || null;
        if (linkError || !inviteLink) {
          console.error('[Admin Users] Sign-in link error:', linkError?.message || 'no link returned', linkError?.status || '');
          return res.status(500).json({ error: 'Failed to make a new sign-in link' });
        }
      }
    }

    if (invited) {
      // The account has no password yet. app_metadata is writable by the
      // service role only, so the person cannot set or clear this mark;
      // /api/account/password-set clears it. A failure does not stop the
      // invite and logs the id and message only, never the link.
      try {
        const { error: markError } = await supabase.auth.admin.updateUserById(targetUser.id, {
          app_metadata: { ...(targetUser.app_metadata || {}), password_pending: true },
        });
        if (markError) throw markError;
      } catch (markErr) {
        console.error('[Admin Users] Could not mark password pending for user', targetUser.id, markErr?.message || '');
      }
    }

    const { error: membershipError } = await supabase
      .from('org_memberships')
      .upsert(
        [
          {
            org_id: orgId,
            user_id: targetUser.id,
            role,
            status: 'active',
          },
        ],
        { onConflict: 'org_id,user_id' },
      );

    if (membershipError) {
      console.error('[Admin Users] Membership error:', membershipError);
      return res.status(500).json({ error: 'Failed to create membership' });
    }

    // Whether the mail went out is lib/email.js's answer, never a guess here:
    // it sends only when Resend is on (EMAIL_PROVIDER=resend and
    // RESEND_API_KEY, from env or saved at /setup) and EMAIL_FROM is set, and
    // otherwise answers sent: false with 'mail_off', 'no_sender' or
    // 'provider_error'. Whenever it was not sent, the owner gets the link to
    // pass on, in this response only, so the new account is never unreachable.
    let mail = null;
    if (inviteLink) {
      const result = await sendMemberInviteEmail({ to: email, inviteLink });
      mail = result?.sent
        ? { mailed: true }
        : { mailed: false, mailReason: result?.reason, inviteLink };
    }

    return res.status(200).json({
      orgId,
      invited,
      ...mail,
      user: {
        id: targetUser.id,
        email: targetUser.email || email,
        role,
      },
    });
  } catch (err) {
    console.error('[Admin Users] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
