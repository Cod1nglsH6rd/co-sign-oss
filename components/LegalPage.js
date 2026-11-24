import Head from 'next/head';
import { useRouter } from 'next/router';
import Navigation from './layout/Navigation';

export default function LegalPage({ title, description, children }) {
  const router = useRouter();
  const locale = router.query?.locale || 'en';

  return (
    <>
      <Head>
        <title>{`${title} — Cô Sign`}</title>
        <meta name="description" content={description || title} />
      </Head>

      <div className="min-h-screen bg-white text-slateish-800">
        <Navigation />

        <main className="pt-32 pb-20">
          <div className="max-w-4xl mx-auto px-6">
            <div className="mb-10">
              <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">Legal</p>
              <h1 className="mt-3 text-3xl sm:text-4xl font-display font-extrabold text-slateish-900">{title}</h1>
              {description && (
                <p className="mt-3 text-slateish-500">{description}</p>
              )}
              <div className="mt-4 text-xs text-slateish-400">
                <a href={`/${locale}`} className="underline hover:text-slateish-600">
                  Back to home
                </a>
              </div>
            </div>

            <div className="prose prose-slate max-w-none">
              {children}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
