/**
 * Landing Page — modern redesign (personal/non-enterprise surface).
 * Uses the shared teal brand system. Cô Sign is self-hosted, so the call to
 * action points to the sign-in page and the self-hosted section, not a waitlist.
 */

import { useRouter } from 'next/router';
import Head from 'next/head';
import { useTranslations } from 'next-intl';
import {
  FiMessageCircle, FiBookOpen, FiGlobe, FiCheckCircle, FiDownload,
  FiZap, FiShield, FiTrendingUp, FiArrowRight, FiCheck,
} from 'react-icons/fi';
import Navigation from '../../components/layout/Navigation';
import { locales, localeNames, localeFlags } from '../../lib/i18n';
import { SUPPORT_EMAIL } from '../../lib/contact';

const FEATURES = [
  { key: 'guide', Icon: FiBookOpen },
  { key: 'translate', Icon: FiGlobe },
  { key: 'verify', Icon: FiCheckCircle },
  { key: 'export', Icon: FiDownload },
];

const VALUES = [
  { key: 'clarity', Icon: FiZap },
  { key: 'confidence', Icon: FiShield },
  { key: 'momentum', Icon: FiTrendingUp },
];

export default function Home() {
  const t = useTranslations();
  const router = useRouter();
  const locale = router.query?.locale || 'en';
  const supportEmail = SUPPORT_EMAIL;

  const handleOpenSupport = () => {
    if (typeof window !== 'undefined') {
      window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent('Co Sign Support')}`;
    }
  };

  return (
    <>
      <Head>
        <title>{t('meta.title')}</title>
        <meta name="description" content={t('meta.description')} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-white text-slateish-800">
        <Navigation />

        {/* ===== Hero ===== */}
        <section className="relative overflow-hidden pt-36 pb-24">
          {/* layered soft background */}
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#ffffff_0%,#f5fbfc_55%,#ffffff_100%)]" />
          <div className="absolute -z-10 -top-32 -left-24 h-[28rem] w-[28rem] rounded-full bg-brand-200/40 blur-3xl" />
          <div className="absolute -z-10 -top-20 right-0 h-[24rem] w-[24rem] rounded-full bg-brand-100/60 blur-3xl" />

          <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-[1.05fr_0.95fr] gap-14 items-center">
            <div className="animate-fade-in">
              <div className="inline-flex items-center gap-2 rounded-full bg-white border border-brand-200 text-brand-700 px-4 py-1.5 text-xs font-semibold shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
                </span>
                {t('hero.badge')}
              </div>

              <h1 className="mt-6 text-4xl sm:text-5xl lg:text-[3.65rem] leading-[1.05] font-display font-extrabold tracking-tight text-slateish-900">
                {t('hero.title')}
                <span className="block text-brand-600 mt-1.5">{t('hero.titleHighlight')}</span>
              </h1>

              <p className="mt-6 text-lg leading-relaxed text-slateish-500 max-w-xl">
                {t('hero.subtitle')}
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a
                  href="/enterprise/login"
                  className="group inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-brand-600 text-white font-semibold shadow-lg shadow-brand-600/20 hover:bg-brand-700 transition-all hover:shadow-brand-600/30"
                >
                  {t('selfHosted.cta')}
                  <FiArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="#features"
                  className="inline-flex items-center justify-center px-7 py-3.5 rounded-full border border-slateish-200 bg-white text-slateish-700 font-semibold hover:border-brand-300 hover:bg-brand-50 transition-colors"
                >
                  {t('hero.ctaSecondary')}
                </a>
              </div>

              {/* language showcase — honest, on-brand differentiator (content is language-neutral) */}
              <div className="mt-10">
                <div className="flex flex-wrap gap-2">
                  {locales.map((loc) => (
                    <span
                      key={loc}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slateish-100 bg-white px-3 py-1 text-xs text-slateish-600 shadow-sm"
                    >
                      <span aria-hidden>{localeFlags[loc]}</span>
                      {localeNames[loc]}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slateish-400">{t('hero.trustedBy')}</p>
              </div>
            </div>

            {/* product preview card */}
            <div className="relative animate-slide-up">
              <div className="absolute -inset-3 -z-10 rounded-[2rem] bg-gradient-to-br from-brand-200/50 to-brand-50/40 blur-2xl" />
              <div className="rounded-3xl border border-slateish-100 bg-white/90 backdrop-blur shadow-2xl overflow-hidden">
                {/* mock window chrome */}
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-slateish-100 bg-slateish-50">
                  <span className="h-2.5 w-2.5 rounded-full bg-slateish-200" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slateish-200" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slateish-200" />
                  <span className="ml-3 text-[11px] font-medium text-slateish-400">{t('concept.kicker')}</span>
                </div>
                <div className="p-6">
                  <div className="text-xs uppercase tracking-widest text-brand-600 font-semibold">{t('concept.kicker')}</div>
                  <h3 className="mt-2 text-xl font-display font-extrabold text-slateish-900">{t('concept.heroTitle')}</h3>
                  <p className="mt-2 text-sm text-slateish-500">{t('concept.heroCopy')}</p>

                  {/* faux form field with a guided explanation */}
                  <div className="mt-5 rounded-2xl border border-slateish-100 p-4 bg-white">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-slateish-800">{t('concept.guide.title')}</div>
                      <FiCheckCircle className="w-4 h-4 text-brand-600" />
                    </div>
                    <div className="mt-2 h-9 rounded-lg border border-slateish-200 bg-slateish-50" />
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-brand-50 p-3">
                      <FiMessageCircle className="mt-0.5 w-4 h-4 text-brand-600 shrink-0" />
                      <p className="text-xs text-brand-800">{t('concept.translate.description')}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {['verify', 'export'].map((key) => (
                      <div key={key} className="flex items-center gap-2 rounded-xl border border-slateish-100 bg-white px-3 py-2.5">
                        <FiCheck className="w-4 h-4 text-brand-600 shrink-0" />
                        <span className="text-xs font-medium text-slateish-700">{t(`concept.${key}.title`)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== Features ===== */}
        <section id="features" className="py-24 bg-white">
          <div className="max-w-6xl mx-auto px-6">
            <div className="max-w-2xl mx-auto text-center mb-14">
              <span className="inline-block text-xs font-bold uppercase tracking-widest text-brand-600">{t('concept.title')}</span>
              <h2 className="mt-3 text-3xl sm:text-4xl font-display font-extrabold text-slateish-900">{t('concept.heroTitle')}</h2>
              <p className="mt-3 text-slateish-500">{t('concept.subtitle')}</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {FEATURES.map(({ key, Icon }) => (
                <div
                  key={key}
                  className="group rounded-2xl border border-slateish-100 bg-white p-6 transition-all hover:border-brand-200 hover:shadow-lg hover:-translate-y-0.5"
                >
                  <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center group-hover:bg-brand-600 group-hover:text-white transition-colors">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="mt-4 font-semibold text-slateish-900">{t(`concept.${key}.title`)}</h3>
                  <p className="mt-1.5 text-sm text-slateish-500">{t(`concept.${key}.description`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== Value props ===== */}
        <section className="py-24 bg-[#f6fbfc]">
          <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-6">
            {VALUES.map(({ key, Icon }) => (
              <div key={key} className="rounded-2xl bg-white border border-slateish-100 p-7 shadow-sm">
                <div className="w-12 h-12 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center">
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="mt-4 text-lg font-display font-bold text-slateish-900">{t(`concept.${key}.title`)}</h3>
                <p className="mt-2 text-sm text-slateish-500">{t(`concept.${key}.description`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== How it works ===== */}
        <section id="how" className="py-24 bg-white">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-slateish-900">{t('howItWorks.title')}</h2>
              <p className="mt-3 text-slateish-500">{t('howItWorks.subtitle')}</p>
            </div>
            <div className="relative grid md:grid-cols-3 gap-8">
              {/* connecting line (desktop) */}
              <div className="hidden md:block absolute top-7 left-[16%] right-[16%] h-px bg-gradient-to-r from-brand-100 via-brand-300 to-brand-100" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="relative text-center">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-600 text-white flex items-center justify-center text-lg font-bold shadow-lg shadow-brand-600/20 ring-8 ring-white">
                    {i}
                  </div>
                  <h3 className="mt-5 font-semibold text-slateish-900">{t(`howItWorks.step${i}.title`)}</h3>
                  <p className="mt-2 text-sm text-slateish-500 max-w-xs mx-auto">{t(`howItWorks.step${i}.description`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== Self-hosted ===== */}
        <section id="self-hosted" className="py-20 bg-white">
          <div className="max-w-4xl mx-auto px-6">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-600 p-10 sm:p-12 text-center shadow-xl">
              <div className="absolute -top-16 -right-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
              <h2 className="text-3xl sm:text-4xl font-display font-extrabold text-white">{t('selfHosted.title')}</h2>
              <p className="mt-3 text-brand-50 max-w-2xl mx-auto">{t('selfHosted.body')}</p>
              <a
                href="/enterprise/login"
                className="mt-8 inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-white text-brand-700 font-semibold hover:bg-brand-50 transition-colors"
              >
                {t('selfHosted.cta')}
                <FiArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>

        {/* ===== Footer ===== */}
        <footer className="bg-slateish-50 border-t border-slateish-100 py-14">
          <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-display font-extrabold text-brand-700">Cô Sign</h3>
              <p className="mt-3 text-sm text-slateish-500">{t('footer.description')}</p>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-widest text-slateish-400">{t('footer.product')}</h4>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slateish-600">
                <a className="hover:text-brand-700" href={`/${locale}#features`}>{t('footer.links.features')}</a>
                <a className="hover:text-brand-700" href={`/${locale}#how`}>{t('howItWorks.title')}</a>
                <a className="hover:text-brand-700" href="/enterprise">Enterprise</a>
              </div>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-widest text-slateish-400">{t('footer.company')}</h4>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slateish-600">
                <a className="hover:text-brand-700" href={`/${locale}#self-hosted`}>{t('selfHosted.title')}</a>
                <a className="hover:text-brand-700" href={`mailto:${supportEmail}`}>{t('footer.links.contact')}</a>
              </div>
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-widest text-slateish-400">{t('footer.legal')}</h4>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slateish-600">
                <a className="hover:text-brand-700" href={`/${locale}/privacy`}>{t('footer.links.privacy')}</a>
                <a className="hover:text-brand-700" href={`/${locale}/terms`}>{t('footer.links.terms')}</a>
                <a className="hover:text-brand-700" href={`/${locale}/cookies`}>{t('footer.links.cookies')}</a>
              </div>
            </div>
          </div>
          <div className="max-w-6xl mx-auto px-6 mt-10 flex flex-col sm:flex-row gap-2 items-center justify-between text-xs text-slateish-400">
            <p>{t('footer.copyright')}</p>
            <p>{locales.map((l) => localeNames[l]).join(' · ')}</p>
          </div>
        </footer>

        <button
          className="fixed right-6 bottom-6 bg-brand-600 text-white w-14 h-14 rounded-full shadow-xl flex items-center justify-center hover:bg-brand-700 transition-colors z-40"
          onClick={handleOpenSupport}
          type="button"
          aria-label="Contact support"
        >
          <FiMessageCircle className="w-6 h-6" />
        </button>
      </div>
    </>
  );
}

export async function getStaticProps({ params }) {
  const { locale } = params;
  return {
    props: {
      messages: (await import(`../../locales/${locale}.json`)).default,
    },
  };
}

export async function getStaticPaths() {
  return {
    paths: locales.map((locale) => ({ params: { locale } })),
    fallback: false,
  };
}
