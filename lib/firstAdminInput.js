/**
 * First admin: check the email and password before anything else.
 *
 * checkFirstAdminInput({ email, password }) is pure: it reads no file, makes
 * no network call and writes nothing to the console. It resolves
 * { ok: false, message } when the email is missing, not a string or
 * malformed (not exactly one @, nothing on one side, no dot in the domain,
 * or spaces inside), or when the password is missing, not a string or
 * shorter than 10 characters. A missing, null or non-object input counts as
 * a missing email; it never throws or rejects. Otherwise it resolves
 * { ok: true, email } with the email trimmed and lower-cased. No result ever
 * holds the password.
 */

export const MIN_PASSWORD_LENGTH = 10;

const EMAIL_MESSAGE = 'Enter a valid email address, like name@example.com.';
const PASSWORD_MESSAGE = `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`;

function normaliseEmail(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const parts = trimmed.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes('.')) return null;
  return trimmed.toLowerCase();
}

export async function checkFirstAdminInput(input) {
  const { email, password } = input && typeof input === 'object' ? input : {};
  const cleanEmail = normaliseEmail(email);
  if (!cleanEmail) return { ok: false, message: EMAIL_MESSAGE };
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: PASSWORD_MESSAGE };
  }
  return { ok: true, email: cleanEmail };
}
