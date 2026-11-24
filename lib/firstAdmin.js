/**
 * First admin: make the first owner account on a fresh host.
 *
 * createFirstAdmin({ email, password }, { supabase, env, cwd }) resolves
 * { status, body }:
 *
 * - 400 { error } when checkFirstAdminInput refuses the input; neither the
 *   lock nor supabase is touched.
 * - 409 { error } when setupNeeded(env, { cwd }) is false or claimFirstAdmin
 *   does not get the lock; no user is created.
 * - Otherwise it creates the user with supabase.auth.admin.createUser
 *   ({ email, password, email_confirm: true }), saves the email as
 *   ADMIN_DASHBOARD_EMAILS in .cosign/settings.json, deletes the setup code
 *   file (removeSetupCode) and gives 201 { email }. A failed delete is
 *   thrown as it is, not hidden behind a 201.
 * - An email Supabase already has gives 409; any other createUser error or
 *   throw gives 500. Each of these releases the lock so the owner can retry.
 * - A failed save gives 500. The user just made is first deleted with
 *   supabase.auth.admin.deleteUser (the id createUser returned; never another
 *   user), then the lock is released, so a retry with the same email works.
 *   If that delete fails too, the lock is kept and the 500 says the account
 *   was left behind and how to remove it by hand.
 * - A claimFirstAdmin or releaseFirstAdmin filesystem error is thrown as it
 *   is; pages/api/setup/admin.js answers it.
 *
 * No body and no log line ever holds the password.
 */

import { checkFirstAdminInput } from './firstAdminInput';
import { saveSettings } from './hostSettings';
import { claimFirstAdmin, releaseFirstAdmin, removeSetupCode, setupNeeded } from './setupLock';

const SETUP_DONE_MESSAGE = 'Setup is already done on this host.';
const EXISTS_MESSAGE = 'An account with that email already exists';
const CREATE_FAILED_MESSAGE = 'The account could not be created. Please try again.';
const SAVE_FAILED_MESSAGE = 'The owner email could not be saved. Please try again.';

function leftBehindMessage(email) {
  return `The owner email could not be saved, and the account made for ${email} was left behind. `
    + 'Delete that user by hand in the Supabase dashboard (Authentication, Users), '
    + 'then delete .cosign/first-admin.lock on this server and try again.';
}

function emailTaken(error) {
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  return /already (been )?registered|already exists/i.test(String(error.message || ''));
}

// Only the error's name, code and status: a message could echo the input.
function logFailure(step, error) {
  console.error(`[firstAdmin] ${step} failed`, {
    name: error && error.name,
    code: error && error.code,
    status: error && error.status,
  });
}

// { userId } when the user was made, or { failed: { status, body } }.
async function createUser(supabase, email, password) {
  try {
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (!error) return { userId: data && data.user ? data.user.id : null };
    if (emailTaken(error)) return { failed: { status: 409, body: { error: EXISTS_MESSAGE } } };
    logFailure('createUser', error);
  } catch (error) {
    logFailure('createUser', error);
  }
  return { failed: { status: 500, body: { error: CREATE_FAILED_MESSAGE } } };
}

// True only when Supabase says the user with this id is deleted.
async function deleteUser(supabase, userId) {
  if (!userId) return false;
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (!error) return true;
    logFailure('deleteUser', error);
  } catch (error) {
    logFailure('deleteUser', error);
  }
  return false;
}

export async function createFirstAdmin(input, { supabase, env = {}, cwd } = {}) {
  const checked = await checkFirstAdminInput(input);
  if (!checked.ok) return { status: 400, body: { error: checked.message } };
  const { email } = checked;

  if (!setupNeeded(env, { cwd })) return { status: 409, body: { error: SETUP_DONE_MESSAGE } };
  const claim = await claimFirstAdmin({ cwd });
  if (!claim.ok) return { status: 409, body: { error: SETUP_DONE_MESSAGE } };

  const created = await createUser(supabase, email, input.password);
  if (created.failed) {
    await releaseFirstAdmin({ cwd });
    return created.failed;
  }

  try {
    saveSettings({ ADMIN_DASHBOARD_EMAILS: email }, { cwd });
  } catch (error) {
    logFailure('saveSettings', error);
    // The lock stays while an account is left behind, so no second admin is made.
    if (!(await deleteUser(supabase, created.userId))) {
      return { status: 500, body: { error: leftBehindMessage(email) } };
    }
    await releaseFirstAdmin({ cwd });
    return { status: 500, body: { error: SAVE_FAILED_MESSAGE } };
  }

  removeSetupCode({ cwd });
  return { status: 201, body: { email } };
}
