/**
 * The password step for someone back from an invite link.
 *
 * authReturnType(hash) is pure: the `type` the auth service puts in the URL
 * fragment when it sends someone back with a session (`#access_token=…&
 * type=invite`), or null when there is none.
 *
 * While a user still has to choose a password, one localStorage entry holds
 * their id. isPasswordPending(userId) is true only for that user; an entry
 * left for another user is removed. When the browser refuses localStorage
 * (some private modes throw on any use), the entry is kept in memory for this
 * page load instead; the auth client then keeps its session in memory too, so
 * neither outlives the tab.
 *
 * The server also marks the account (app_metadata.password_pending, set for a
 * new invited account, cleared by POST /api/account/password-set), and the
 * mark travels in the session, so the step follows the person to any browser
 * where they are signed in. A second entry (markPasswordSaved) holds the id
 * of a user whose password this browser knows is saved: updateUser succeeded
 * here, or they signed in here with a password. passwordStep(user) is the one
 * rule the gate, the sign-in page and the form follow:
 *   'choose'  the entry is set for user.id or the session carries the mark,
 *             and this browser does not know the password is saved: the form.
 *   'finish'  the session carries the mark, but the password is saved: only
 *             the route and the session refresh are left. That never holds
 *             the person up (they have a password): the enterprise pages let
 *             them through, the sign-in page offers to try again or go on,
 *             and the next password sign-in tries it again.
 *   null      nothing to do.
 * needsPassword(user) is passwordStep(user) === 'choose'.
 *
 * The entry is not a security boundary. Whoever removes it only skips the
 * step for the account they are already signed in to; the step itself only
 * ever sets the password of the session's own user.
 */

const PENDING_KEY = 'cosign.invitePasswordPending';
const SAVED_KEY = 'cosign.invitePasswordSaved';
let memoryUserId = null;
let memorySavedId = null;

export function authReturnType(hash) {
  if (typeof hash !== 'string' || !hash) return null;
  return new URLSearchParams(hash.replace(/^#/, '')).get('type') || null;
}

export function markPasswordPending(userId) {
  if (!userId) return;
  memoryUserId = userId;
  try {
    window.localStorage.setItem(PENDING_KEY, userId);
  } catch (err) {
    // No storage: the memory copy above serves this page load.
  }
}

export function clearPasswordPending() {
  memoryUserId = null;
  memorySavedId = null;
  try {
    window.localStorage.removeItem(PENDING_KEY);
    window.localStorage.removeItem(SAVED_KEY);
  } catch (err) {
    // No storage: nothing more to remove.
  }
}

export function isPasswordPending(userId) {
  let stored;
  try {
    stored = window.localStorage.getItem(PENDING_KEY);
  } catch (err) {
    stored = memoryUserId;
  }
  if (!stored || !userId) return false;
  if (stored === userId) return true;
  clearPasswordPending();
  return false;
}

export function passwordStep(user) {
  if (!user?.id) return null;
  const marked = user.app_metadata?.password_pending === true;
  if (isPasswordSaved(user.id)) return marked ? 'finish' : null;
  // The entry first: isPasswordPending also removes one left for another id.
  return isPasswordPending(user.id) || marked ? 'choose' : null;
}

export function needsPassword(user) {
  return passwordStep(user) === 'choose';
}

export function markPasswordSaved(userId) {
  if (!userId) return;
  memorySavedId = userId;
  try {
    window.localStorage.setItem(SAVED_KEY, userId);
  } catch (err) {
    // No storage: the memory copy above serves this page load.
  }
}

export function isPasswordSaved(userId) {
  let stored;
  try {
    stored = window.localStorage.getItem(SAVED_KEY);
  } catch (err) {
    stored = memorySavedId;
  }
  return Boolean(userId) && stored === userId;
}
