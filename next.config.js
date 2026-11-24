const fs = require('fs');
const path = require('path');
const { buildCsp } = require('./lib/csp');
const { effectiveSetting } = require('./lib/hostSettings');

// The origin of this install's site address (NEXT_PUBLIC_APP_URL from the
// environment, else the one saved at setup), or null when there is none or it
// is not an http(s) URL. Read when `next build` runs: headers() below is
// written into .next/routes-manifest.json then, and the server only reads
// that file, so a later change needs a new build. The Docker image is built
// without the environment or saved settings, so it sends no CORS header.
function siteOrigin() {
  const address = effectiveSetting('NEXT_PUBLIC_APP_URL', process.env);
  if (!address) return null;
  try {
    const url = new URL(address.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function resolvePdfJsDistPath(relativePath) {
  const reactPdfBundled = path.join(__dirname, 'node_modules/react-pdf/node_modules/pdfjs-dist', relativePath);
  if (fs.existsSync(reactPdfBundled)) return reactPdfBundled;
  return path.join(__dirname, 'node_modules/pdfjs-dist', relativePath);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // A self-contained server in .next/standalone (node server.js) for the
  // Docker image in home hosting (issue co-sign-295).
  output: 'standalone',

  // Environment variables
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },

  // Image domains for external images
  images: {
    domains: ['lh3.googleusercontent.com'],
    // Keep Next image optimization disabled to avoid on-disk cache growth risks.
    // This app currently does not rely on <Image /> optimization features.
    unoptimized: true,
  },

  // Ensure pdfjs-dist is not tree-shaken from server bundles.
  // tesseract.js is loaded at runtime (OCR-anchor positioning path) — keep it
  // external so its worker/wasm assets aren't bundled into the serverless function.
  serverExternalPackages: ['pdfjs-dist', 'canvas', 'tesseract.js'],

  // Webpack configuration for PDF processing
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // pdfjs-dist non-minified .mjs builds can fail under Next webpack eval wrapping.
      // Force minified builds, which avoid the problematic export shadowing.
      'pdfjs-dist$': resolvePdfJsDistPath('build/pdf.min.mjs'),
      'pdfjs-dist/build/pdf.mjs$': resolvePdfJsDistPath('build/pdf.min.mjs'),
      'pdfjs-dist/legacy/build/pdf.mjs$': resolvePdfJsDistPath('legacy/build/pdf.min.mjs'),
      'pdfjs-dist/build/pdf.worker.mjs$': resolvePdfJsDistPath('build/pdf.worker.min.mjs'),
      'pdfjs-dist/legacy/build/pdf.worker.mjs$': resolvePdfJsDistPath('legacy/build/pdf.worker.min.mjs'),
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        canvas: false,
      };
    }
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('canvas');
      // Prevent webpack from bundling pdfjs-dist into server functions
      // (it's large and breaks when bundled). react-pdf uses it client-side only.
      config.externals.push(/^pdfjs-dist/);
    }
    return config;
  },

  // The pricing and billing pages were removed (no plans are sold). Old links
  // and bookmarks go home instead of 404.
  // These run before middleware.js, so the bare paths never get a locale added.
  // The locale list matches `locales` in lib/i18n.js (an ES module, so it is
  // repeated here); tests/lib/removedPageRedirects.test.js keeps them in step.
  async redirects() {
    const locales = 'en|vi|es|pt|fr|zh|yue|ht|ne';
    return ['pricing', 'billing'].flatMap((page) => [
      { source: `/${page}`, destination: '/', permanent: true },
      { source: `/:locale(${locales})/${page}`, destination: '/:locale', permanent: true },
    ]);
  },

  // API routes configuration
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: '/api/:path*',
      },
    ];
  },

  // Headers for CORS and security
  async headers() {
    // Non-framing security headers applied everywhere.
    const baseSecurityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      // A plain max-age: includeSubDomains and preload would pin every
      // subdomain of the owner's domain to HTTPS for two years.
      { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
    ];

    // Anti-framing headers. Applied everywhere EXCEPT /embed/* — the embeddable
    // signing widget sets its own per-session `frame-ancestors` in
    // getServerSideProps (these config headers would otherwise override it, since
    // next.config headers win over what GSSP sets).
    const frameHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: buildCsp("'none'") },
    ];

    // CORS for /api allows only the install's own origin, and is left out
    // when the site address is not set.
    const origin = siteOrigin();
    const corsHeaders = origin
      ? [
          { key: 'Access-Control-Allow-Origin', value: origin },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type, X-Session-Verify, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version' },
        ]
      : [];

    return [
      {
        // API is never framed — keep the strict frame headers here.
        source: '/api/:path*',
        headers: [...baseSecurityHeaders, ...frameHeaders, ...corsHeaders],
      },
      {
        // Pages get base security headers here. Frame headers + the page CSP are
        // set in middleware.js, which can deny framing for normal pages and lock
        // /embed to its session's origin (next.config headers can't be overridden
        // per-request, so middleware owns the per-path framing policy).
        source: '/:path*',
        headers: baseSecurityHeaders,
      },
    ];
  },
};

// PRD §8.3: only engage Sentry's build plugin when a DSN is configured, so
// CI/dev builds stay fast and don't require a Sentry auth token.
if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
  // eslint-disable-next-line global-require
  const { withSentryConfig } = require('@sentry/nextjs');
  module.exports = withSentryConfig(nextConfig, {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    widenClientFileUpload: false,
  });
} else {
  module.exports = nextConfig;
}
