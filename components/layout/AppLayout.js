/**
 * AppLayout — shared chrome for authenticated personal pages
 * (settings, archived). Unifies the header, background, and content
 * width that each page previously hand-rolled, on the teal brand system.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FiLogOut, FiSettings, FiFileText } from 'react-icons/fi';

export default function AppLayout({
  locale = 'en',
  onSignOut,
  children,
  maxWidth = 'max-w-4xl',
}) {
  const t = useTranslations('nav');
  const nav = [
    { href: `/${locale}/dashboard`, label: t('documents'), Icon: FiFileText },
    { href: `/${locale}/settings`, label: t('settings'), Icon: FiSettings },
  ];

  return (
    <div className="min-h-screen bg-slateish-50 text-slateish-800">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slateish-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href={`/${locale}`} className="font-display font-extrabold text-brand-700">
            Cô Sign
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            {nav.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm text-slateish-600 hover:text-brand-700 hover:bg-brand-50 transition-colors"
              >
                <Icon className="w-4 h-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
            {onSignOut && (
              <button
                onClick={onSignOut}
                type="button"
                aria-label={t('logout')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-slateish-200 text-sm hover:border-brand-300 hover:bg-brand-50 transition-colors"
              >
                <FiLogOut className="w-4 h-4" aria-hidden />
                <span className="hidden sm:inline">{t('logout')}</span>
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className={`${maxWidth} mx-auto px-6 py-10`}>{children}</main>
    </div>
  );
}
