import { useTranslations } from 'next-intl';

// Shown at the top of the terms and privacy pages: they are templates that
// came with this self-hosted app, and whoever runs the site must replace them.
export default function LegalTemplateNotice() {
  const t = useTranslations('legalTemplate');
  return (
    <div role="note" className="not-prose mb-8 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <p className="font-semibold">{t('title')}</p>
      <p className="mt-1 text-sm">{t('body')}</p>
    </div>
  );
}
