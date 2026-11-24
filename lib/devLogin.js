/**
 * Email of the shared dev/test account: the enterprise dev-login shortcut
 * `admin` maps to it and `npm run seed:dev` creates it. Override with
 * NEXT_PUBLIC_DEV_LOGIN_EMAIL (named literally so Next.js inlines it).
 * CommonJS so the plain-node seed script can require it.
 */

const DEV_EMAIL = process.env.NEXT_PUBLIC_DEV_LOGIN_EMAIL || 'admin@example.com';

module.exports = { DEV_EMAIL };
