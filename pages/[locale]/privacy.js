import LegalPage from '../../components/LegalPage';
import LegalTemplateNotice from '../../components/LegalTemplateNotice';
import { SUPPORT_EMAIL } from '../../lib/contact';

const EFFECTIVE_DATE = 'March 14, 2026';
const COMPANY_NAME = 'cosign';
const CONTACT_EMAIL = SUPPORT_EMAIL;

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" description={`Effective date: ${EFFECTIVE_DATE}`}>
      <LegalTemplateNotice />
      <p>
        This Privacy Policy explains how {COMPANY_NAME} collects, uses, and shares information when you
        use our services.
      </p>

      <h2>1. Information We Collect</h2>
      <ul>
        <li><strong>Contact information:</strong> such as your email address (e.g., beta signups).</li>
        <li><strong>User Content:</strong> documents and information you upload for processing.</li>
        <li><strong>Usage data:</strong> interactions with the Service, device and browser information.</li>
        <li><strong>Cookies:</strong> as described in our Cookies Policy.</li>
      </ul>

      <h2>2. How We Use Information</h2>
      <ul>
        <li>Provide and improve the Service.</li>
        <li>Process, analyze, and store uploaded documents to deliver results.</li>
        <li>Communicate with you about beta access and product updates.</li>
        <li>Maintain security, prevent abuse, and comply with legal obligations.</li>
      </ul>

      <h2>3. How We Share Information</h2>
      <p>
        We may share information with service providers who help us operate the Service (e.g., hosting,
        analytics, email delivery). We may also share information if required by law or to protect our
        rights and users.
      </p>

      <h2>4. Data Retention</h2>
      <p>
        We retain information for as long as necessary to provide the Service or as required by law.
        You may request deletion of your data by contacting us.
      </p>

      <h2>5. Security</h2>
      <p>
        We use reasonable technical and organizational measures to protect your information. No method
        of transmission or storage is 100% secure.
      </p>

      <h2>6. Your Choices</h2>
      <p>
        You can request access, correction, or deletion of your personal information by contacting us at
        <a href={`mailto:${CONTACT_EMAIL}`}> {CONTACT_EMAIL}</a>.
      </p>

      <h2>7. International Users</h2>
      <p>
        The Service is operated in the United States. If you access the Service from other regions, you
        consent to the transfer and processing of your information in the United States.
      </p>

      <h2>8. Children’s Privacy</h2>
      <p>
        The Service is not directed to children under 13. We do not knowingly collect personal information
        from children.
      </p>

      <h2>9. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will update the effective date above when
        changes are made.
      </p>

      <h2>10. Contact</h2>
      <p>
        If you have questions about this Privacy Policy, contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
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
