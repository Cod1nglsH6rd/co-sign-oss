import LegalPage from '../../components/LegalPage';
import { SUPPORT_EMAIL } from '../../lib/contact';

const EFFECTIVE_DATE = 'March 14, 2026';
const COMPANY_NAME = 'cosign';
const CONTACT_EMAIL = SUPPORT_EMAIL;

export default function CookiesPage() {
  return (
    <LegalPage title="Cookies Policy" description={`Effective date: ${EFFECTIVE_DATE}`}>
      <p>
        This Cookies Policy explains how {COMPANY_NAME} uses cookies and similar technologies on our
        website and services.
      </p>

      <h2>1. What Are Cookies?</h2>
      <p>
        Cookies are small text files stored on your device that help websites function and improve your
        experience. We may also use similar technologies such as local storage or pixels.
      </p>

      <h2>2. Types of Cookies We Use</h2>
      <ul>
        <li><strong>Essential cookies:</strong> required for the Service to function properly.</li>
        <li><strong>Analytics cookies:</strong> help us understand usage and improve performance.</li>
        <li><strong>Marketing cookies:</strong> used to deliver relevant communications or advertising.</li>
      </ul>

      <h2>3. Managing Cookies</h2>
      <p>
        You can control cookies through your browser settings. You may be able to block or delete cookies,
        but some features of the Service may not function properly.
      </p>

      <h2>4. Third-Party Cookies</h2>
      <p>
        We may use third-party services for analytics or marketing. These providers may set cookies
        on your device according to their own policies.
      </p>

      <h2>5. Do Not Track</h2>
      <p>
        Some browsers offer a “Do Not Track” signal. The Service does not currently respond to Do Not Track
        signals.
      </p>

      <h2>6. Changes to This Policy</h2>
      <p>
        We may update this Cookies Policy from time to time. We will update the effective date above when
        changes are made.
      </p>

      <h2>7. Contact</h2>
      <p>
        If you have questions about this Cookies Policy, contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}

export async function getStaticProps({ params }) {
  const { locale } = params;
  return {
    props: {
      messages: (await import(`../../locales/${locale}.json`)).default
    }
  };
}

export async function getStaticPaths() {
  return {
    paths: [
      { params: { locale: 'en' } },
      { params: { locale: 'vi' } },
      { params: { locale: 'es' } },
      { params: { locale: 'pt' } },
      { params: { locale: 'fr' } },
      { params: { locale: 'zh' } },
      { params: { locale: 'yue' } },
      { params: { locale: 'ht' } },
      { params: { locale: 'ne' } }
    ],
    fallback: false
  };
}
