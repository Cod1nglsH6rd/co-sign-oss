import NextDocument, { Html, Head, Main, NextScript } from 'next/document';

const KNOWN_LOCALES = new Set(['en', 'vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne']);

// Latin UI fonts (Plus Jakarta Sans / Fraunces) plus Noto families that cover the
// non-Latin scripts we support: CJK (zh/yue) and Devanagari (ne). Without these,
// Nepali renders as tofu on systems lacking the fonts.
const FONT_HREF =
  'https://fonts.googleapis.com/css2' +
  '?family=Fraunces:wght@500;600;700;800' +
  '&family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900' +
  '&family=Noto+Sans+SC:wght@400;500;700' +
  '&family=Noto+Sans+TC:wght@400;500;700' +
  '&family=Noto+Sans+Devanagari:wght@400;500;700' +
  '&display=swap';

export default function Document({ locale = 'en' }) {
  return (
    <Html lang={locale}>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={FONT_HREF} rel="stylesheet" />
        {/* Blocking on purpose: sets window.__COSIGN_PUBLIC__ (database address
            and anon key from the running server) before the app bundle runs. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/api/runtime-config.js" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

// Derive the <html lang> from the route locale (recipient pages live under
// /[locale]) so screen readers and hyphenation match the page's language.
Document.getInitialProps = async (ctx) => {
  const initialProps = await NextDocument.getInitialProps(ctx);
  let locale = 'en';
  const fromQuery = ctx?.query?.locale;
  if (typeof fromQuery === 'string' && KNOWN_LOCALES.has(fromQuery)) {
    locale = fromQuery;
  } else {
    const url = ctx?.req?.url || ctx?.asPath || '';
    const seg = String(url).split('?')[0].split('/').filter(Boolean)[0];
    if (seg && KNOWN_LOCALES.has(seg)) locale = seg;
  }
  return { ...initialProps, locale };
};
