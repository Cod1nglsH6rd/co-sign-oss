/**
 * Navigation Component
 * Responsive header with language selector
 */

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { FiMenu, FiX, FiChevronDown } from 'react-icons/fi';
import { locales, localeNames, localeFlags } from '../../lib/i18n';

export default function Navigation() {
  const t = useTranslations('nav');
  const router = useRouter();
  const locale = router.query?.locale || 'en';
  const { asPath } = router;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [langQuery, setLangQuery] = useState('');
  const langMenuRef = useRef(null);

  useEffect(() => {
    if (!langMenuOpen) return;
    const handler = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [langMenuOpen]);

  // When closed, reset the search so it reopens clean.
  useEffect(() => {
    if (!langMenuOpen) setLangQuery('');
  }, [langMenuOpen]);

  const filteredLocales = locales.filter((loc) => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return true;
    return loc.toLowerCase().includes(q) || (localeNames[loc] || '').toLowerCase().includes(q);
  });

  const changeLocale = (newLocale) => {
    // Replace the locale segment in the URL
    const newPath = asPath.replace(`/${locale}`, `/${newLocale}`);
    router.push(newPath);
    setLangMenuOpen(false);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-black/5 bg-white/80 backdrop-blur-2xl">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between h-[72px]">
          {/* Logo */}
          <Link href={`/${locale}`} className="flex items-center gap-2">
            <img
              src="/logo/cosign-logo.png"
              alt="Co Sign"
              className="h-9 w-auto"
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <Link href={`/${locale}#how`} className="text-sm text-slateish-600 hover:text-brand-700">
              How It Works
            </Link>
            <Link href={`/${locale}#features`} className="text-sm text-slateish-600 hover:text-brand-700">
              {t('features')}
            </Link>
            <Link href="/enterprise" className="text-sm text-slateish-600 hover:text-brand-700">
              Enterprise
            </Link>

            {/* Language Selector */}
            <div className="relative" ref={langMenuRef}>
              <button
                onClick={() => setLangMenuOpen(!langMenuOpen)}
                className="flex items-center gap-2 text-sm text-slateish-600 hover:text-slateish-800 px-3 py-2 rounded-full border border-slateish-200 hover:border-brand-300"
              >
                <span>{localeFlags[locale]} {localeNames[locale]}</span>
                <FiChevronDown className={`w-4 h-4 transition-transform ${langMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {langMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl shadow-lg border border-slateish-100 bg-white py-2 z-50">
                  <div className="px-3 pb-2">
                    <input
                      type="text"
                      autoFocus
                      value={langQuery}
                      onChange={(e) => setLangQuery(e.target.value)}
                      placeholder="Search language…"
                      className="w-full text-sm px-3 py-1.5 rounded-lg border border-slateish-200 focus:border-brand-300 focus:outline-none"
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {filteredLocales.map((loc) => (
                      <button
                        key={loc}
                        onClick={() => changeLocale(loc)}
                        className={`w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-slateish-50 transition-colors
                          ${loc === locale ? 'text-brand-700 bg-brand-50' : 'text-slateish-700'}`}
                      >
                        <span className="text-lg">{localeFlags[loc]}</span>
                        <span>{localeNames[loc]}</span>
                      </button>
                    ))}
                    {filteredLocales.length === 0 && (
                      <p className="px-4 py-2 text-sm text-slateish-400">No match</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Auth Buttons */}
            <div className="flex items-center gap-3">
              <Link href={`/${locale}/login`} className="text-sm font-semibold text-slateish-600 hover:text-brand-700">
                {t('login')}
              </Link>
            </div>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-slateish-100 transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <FiX className="w-6 h-6 text-slateish-600" />
            ) : (
              <FiMenu className="w-6 h-6 text-slateish-600" />
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-slateish-100">
            <div className="flex flex-col gap-4">
              <Link
                href={`/${locale}#how`}
                className="text-slateish-600 hover:text-slateish-900 transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                How It Works
              </Link>
              <Link
                href="/enterprise"
                className="text-slateish-600 hover:text-slateish-900 transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                Enterprise
              </Link>
              <Link
                href={`/${locale}/login`}
                className="text-slateish-600 hover:text-slateish-900 transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t('login')}
              </Link>
              <Link
                href={`/${locale}#features`}
                className="text-slateish-600 hover:text-slateish-900 transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t('features')}
              </Link>

              {/* Mobile Language Selector */}
              <div className="border-t border-slateish-100 pt-4 mt-2">
                <p className="text-sm text-slateish-500 mb-2">Language</p>
                <div className="flex flex-wrap gap-2">
                  {locales.map((loc) => (
                    <button
                      key={loc}
                      onClick={() => {
                        changeLocale(loc);
                        setMobileMenuOpen(false);
                      }}
                      className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors
                        ${loc === locale
                          ? 'bg-brand-100 text-brand-700'
                          : 'bg-slateish-100 text-slateish-600 hover:bg-slateish-200'
                        }`}
                    >
                      <span>{localeFlags[loc]}</span>
                      <span>{localeNames[loc]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
