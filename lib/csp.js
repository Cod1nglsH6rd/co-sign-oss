/**
 * Content-Security-Policy builder.
 *
 * Shared between next.config.js (global headers, frame-ancestors 'none') and the
 * SSR embed page, which overrides only `frame-ancestors` per session so the
 * widget can be iframed by the customer's own origin without weakening the rest
 * of the policy. CommonJS so next.config.js can `require` it.
 */
function buildCsp(frameAncestors = "'none'") {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.supabase.co",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // 'wasm-unsafe-eval' allows the WebAssembly that react-pdf/pdfjs compiles in
    // the browser, WITHOUT permitting arbitrary JS eval()/new Function() (a
    // classic XSS escalation vector). 'unsafe-inline' remains required for Next's
    // Pages-Router framework scripts (no clean nonce path) — see SECURITY-AUDIT M4.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://*.sentry.io",
    // Kept as strict as it was without the Stripe host: no page frames anything.
    "frame-src 'none'",
  ].join('; ');
}

module.exports = { buildCsp };
