/**
 * Next.js App Component
 * Global app configuration and providers
 */

import '../styles/globals.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { NextIntlClientProvider } from 'next-intl';
import { supabase } from '../lib/supabaseClient';
import SetupGate from '../components/SetupGate';

function MyApp({ Component, pageProps }) {
  const router = useRouter();

  // Password-recovery links land wherever Supabase's redirect allow-list sends
  // them (worst case the site root). The client consumes the hash tokens on any
  // page, so route the PASSWORD_RECOVERY event to the reset form globally.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !router.pathname.includes('reset-password')) {
        const locale = router.query?.locale || 'en';
        router.push(`/${locale}/reset-password`);
      }
    });
    return () => listener?.subscription?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <NextIntlClientProvider
      locale={router.query?.locale || 'en'}
      messages={pageProps.messages}
      timeZone="America/New_York"
    >
      {/* Fresh install: send visitors to /setup */}
      <SetupGate />
      <Component {...pageProps} />

      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#fff',
            color: '#363636',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />
    </NextIntlClientProvider>
  );
}

export default MyApp;
