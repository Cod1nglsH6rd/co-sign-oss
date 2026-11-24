/**
 * Email Notification Utilities
 *
 * Mail goes out through Resend only when the resend adapter is on
 * (lib/adapters.js): EMAIL_PROVIDER=resend and RESEND_API_KEY both set.
 * Otherwise nothing is sent and one stdout line names the subject and the
 * recipient's domain (never the address or the body).
 *
 * Settings, each read through effectiveSetting when mail is sent (env first,
 * then the answer saved at setup in .cosign/settings.json):
 * - EMAIL_PROVIDER — `resend` to send mail; anything else keeps it local
 * - RESEND_API_KEY — Resend API key
 * - EMAIL_FROM — Sender address; there is no default. With Resend on and no
 *   EMAIL_FROM nothing is sent and one line names the setting.
 * - NEXT_PUBLIC_APP_URL — base of links in mail (default: http://localhost:3000)
 *
 * sendFillInviteEmail, sendCompletionNotificationEmail and sendMemberInviteEmail return
 * { sent: true } when Resend accepted the mail, else { sent: false, reason }
 * with reason 'mail_off', 'no_sender', 'provider_error' or 'no_recipient'.
 * The log names the recipient's domain only, never the address.
 */

import { adapterStatus } from './adapters';
import { effectiveSetting } from './hostSettings';

// Each setting read by its own name, so the env-sync check can see it.
function mailEnv() {
  return {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

function mailSetting(name) {
  return effectiveSetting(name, mailEnv());
}

// The host owner's sender (env, or saved at setup), or null: there is no
// built-in one.
function emailFrom() {
  const from = mailSetting('EMAIL_FROM');
  return typeof from === 'string' && from.trim() ? from.trim() : null;
}

function appUrl() {
  return mailSetting('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000';
}

function recipientDomain(to) {
  const at = String(to).lastIndexOf('@');
  return at === -1 ? '(no domain)' : String(to).slice(at + 1);
}

/**
 * Send an email using the configured provider
 * @param {object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.subject - Email subject
 * @param {string} params.html - HTML body
 * @param {string} [params.text] - Plain text body
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function deliverEmail({ to, subject, html, text }) {
  if (!to) {
    console.warn('[Email] No recipient provided, skipping');
    return { sent: false, reason: 'no_recipient' };
  }

  const apiKey = mailSetting('RESEND_API_KEY');
  const { resend } = adapterStatus({ EMAIL_PROVIDER: mailSetting('EMAIL_PROVIDER'), RESEND_API_KEY: apiKey });
  if (resend !== 'on') {
    // Local fallback: no mail, one line, no address or body.
    console.log(`[Email] Resend off, not sent: "${subject}" to @${recipientDomain(to)}`);
    return { sent: false, reason: 'mail_off' };
  }

  const from = emailFrom();
  if (!from) {
    console.error(`[Email] EMAIL_FROM is not set, not sent: "${subject}" to @${recipientDomain(to)}. Set EMAIL_FROM (or the From address at setup) to the address mail should come from.`);
    return { sent: false, reason: 'no_sender' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text: text || subject,
      }),
    });

    if (!response.ok) {
      // Only the status: Resend's error body may repeat what was sent.
      console.error(`[Email] Resend error: HTTP ${response.status}`);
      return { sent: false, reason: 'provider_error' };
    }
    console.log(`[Email] Sent: "${subject}" to @${recipientDomain(to)}`);
    return { sent: true };
  } catch (err) {
    const message = String(err && err.message).split(apiKey.trim()).join('[key]');
    console.error('[Email] Send failed:', message);
    return { sent: false, reason: 'provider_error' };
  }
}

// Kept returning nothing, as before; the send functions below return the result.
async function sendEmail(params) {
  await deliverEmail(params);
}

/**
 * Send fill invitation email to customer
 */
export async function sendFillInviteEmail({
  baseUrl,
  to,
  recipientName,
  documentName,
  token,
  expiresAt,
  clientName,
  language = 'en',
}) {
  const fillUrl = `${baseUrl || appUrl()}/${language}/fill/${token}`;
  const expiryDate = new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const subject = `You've been invited to fill out: ${documentName}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af, #7c3aed); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Cô Sign</h1>
      </div>
      <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px; color: #374151;">
          Hi${recipientName ? ` ${recipientName}` : ''},
        </p>
        <p style="font-size: 16px; color: #374151;">
          <strong>${clientName || 'Someone'}</strong> has invited you to fill out <strong>${documentName}</strong>.
        </p>
        <p style="font-size: 14px; color: #6b7280;">
          You can fill this form in your preferred language — English, Vietnamese, or Spanish.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${fillUrl}" style="display: inline-block; background: #1e40af; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
            Fill Out Document
          </a>
        </div>
        <p style="font-size: 13px; color: #9ca3af;">
          This link expires on ${expiryDate}. If you have questions, please contact the sender.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">
          Powered by Cô Sign — AI-powered document translation & signing
        </p>
      </div>
    </div>
  `;

  return deliverEmail({ to, subject, html });
}

/**
 * Send completion notification email to client
 */
export async function sendCompletionNotificationEmail({
  to,
  clientName,
  recipientName,
  documentName,
  documentId,
  sessionId,
  filledPdfUrl,
}) {
  const dashboardUrl = `${appUrl()}/en/documents/${documentId}`;

  const subject = `${recipientName || 'Your recipient'} completed: ${documentName}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #059669, #10b981); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Document Completed</h1>
      </div>
      <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px; color: #374151;">
          Hi${clientName ? ` ${clientName}` : ''},
        </p>
        <p style="font-size: 16px; color: #374151;">
          <strong>${recipientName || 'Your recipient'}</strong> has completed filling out <strong>${documentName}</strong>.
        </p>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0; color: #166534; font-weight: 600;">All fields have been filled and submitted.</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${dashboardUrl}" style="display: inline-block; background: #1e40af; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
            View in Dashboard
          </a>
        </div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">
          Powered by Cô Sign — AI-powered document translation & signing
        </p>
      </div>
    </div>
  `;

  return deliverEmail({ to, subject, html });
}

/**
 * Send an invitation to join an organization, with the one-time link the
 * auth service made. Returns what deliverEmail returns.
 */
export async function sendMemberInviteEmail({ to, inviteLink }) {
  const subject = "You've been invited to Cô Sign";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af, #7c3aed); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Cô Sign</h1>
      </div>
      <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px; color: #374151;">Hi,</p>
        <p style="font-size: 16px; color: #374151;">
          You have been added to an organization on Cô Sign. Use the button below to set up your account.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${inviteLink}" style="display: inline-block; background: #1e40af; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
            Accept Invitation
          </a>
        </div>
        <p style="font-size: 13px; color: #9ca3af;">
          This link works once. If you did not expect it, you can ignore this email.
        </p>
      </div>
    </div>
  `;

  return deliverEmail({ to, subject, html, text: `${subject}. Accept the invitation: ${inviteLink}` });
}

export { sendEmail };
