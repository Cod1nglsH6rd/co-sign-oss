import { NextResponse } from 'next/server';
import { locales, defaultLocale } from './lib/i18n';
import { buildCsp } from './lib/csp';
import { serverSupabaseUrl, serviceKey } from './lib/supabaseEnv';

// Edge-compatible SHA-256 hex (matches lib/sessionAuth.hashToken).
async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Resolve the frame-ancestors policy for an /embed/[token] request: the widget
// may only be framed by the origin the session was created for. Fail closed to
// 'none' on any miss/error so framing is never silently broadened.
async function embedFrameAncestors(pathname) {
  const match = pathname.match(/^\/embed\/([^/?#]+)/);
  if (!match) return "'none'";
  try {
    const token = decodeURIComponent(match[1]);
    const url = serverSupabaseUrl();
    const key = serviceKey();
    if (!url || !key) return "'none'";
    const hash = await sha256Hex(token);
    const resp = await fetch(
      `${url}/rest/v1/fill_sessions?token_hash=eq.${hash}&select=embed_origin&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!resp.ok) return "'none'";
    const rows = await resp.json();
    const origin = rows && rows[0] && rows[0].embed_origin;
    if (origin && /^https?:\/\/[^\s'"]+$/.test(origin)) {
      return `'self' ${origin}`;
    }
    return "'none'";
  } catch {
    return "'none'";
  }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );

  const skipLocaleRedirect =
    pathnameHasLocale ||
    pathname === '/' ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/enterprise') ||
    pathname.startsWith('/embed') ||
    pathname === '/setup' ||
    pathname.startsWith('/setup/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/_vercel') ||
    pathname.includes('.');

  let response;
  if (skipLocaleRedirect) {
    response = NextResponse.next();
  } else {
    const url = request.nextUrl.clone();
    url.pathname = `/${defaultLocale}${pathname}`;
    response = NextResponse.redirect(url);
  }

  // Framing policy. The /embed page is the only one allowed to be iframed, and
  // only by its session's origin; every other page denies framing entirely.
  // (next.config headers can't be overridden per-request, so middleware owns it.)
  if (pathname.startsWith('/embed/')) {
    const frameAncestors = await embedFrameAncestors(pathname);
    response.headers.set('Content-Security-Policy', buildCsp(frameAncestors));
    response.headers.delete('X-Frame-Options');
  } else {
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Content-Security-Policy', buildCsp("'none'"));
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
