import LegalPage from '../../components/LegalPage';
import LegalTemplateNotice from '../../components/LegalTemplateNotice';
import { SUPPORT_EMAIL } from '../../lib/contact';

const EFFECTIVE_DATE = 'March 14, 2026';
const COMPANY_NAME = 'cosign';
const CONTACT_EMAIL = SUPPORT_EMAIL;

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" description={`Effective date: ${EFFECTIVE_DATE}`}>
      <LegalTemplateNotice />
      <p>
        These Terms of Service (“Terms”) govern your access to and use of the {COMPANY_NAME} website,
        applications, and services (collectively, the “Service”). By using the Service, you agree to
        these Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        {COMPANY_NAME} provides an AI-assisted experience to help users understand, translate, and
        complete forms and documents. You may upload documents to the Service for processing and
        receive guidance, translations, or exports.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 13 years old to use the Service. If you are under the age of majority in
        your jurisdiction, you may only use the Service under the supervision of a parent or legal guardian.
      </p>

      <h2>3. Accounts and Beta Access</h2>
      <p>
        Some features may require an account or beta access. You are responsible for maintaining the
        confidentiality of your account credentials and for all activity under your account.
      </p>

      <h2>4. User Content and Document Processing</h2>
      <p>
        You retain ownership of the documents and information you upload (“User Content”). By uploading
        User Content, you grant {COMPANY_NAME} permission to process, store, and display the content
        as necessary to provide the Service. You represent that you have the right to upload the User Content.
      </p>

      <h2>5. Acceptable Use</h2>
      <p>You agree not to misuse the Service. You will not:</p>
      <ul>
        <li>Use the Service for unlawful, harmful, or deceptive purposes.</li>
        <li>Upload content you do not have rights to or that violates privacy or confidentiality.</li>
        <li>Interfere with or disrupt the Service or its security features.</li>
        <li>Attempt to reverse engineer or bypass access controls.</li>
      </ul>

      <h2>6. Intellectual Property</h2>
      <p>
        The Service and all related content (excluding User Content) are owned by {COMPANY_NAME} and
        are protected by intellectual property laws. These Terms do not grant you any rights in the Service
        except as expressly stated.
      </p>

      <h2>7. Privacy</h2>
      <p>
        Our Privacy Policy explains how we collect and use information. By using the Service, you agree
        to our Privacy Policy.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        The Service is provided “as is” and “as available.” {COMPANY_NAME} does not provide legal,
        financial, or tax advice. You are responsible for reviewing all outputs and submissions.
      </p>

      <h2>9. Limitation of Liability</h2>
      <p>
        To the fullest extent permitted by law, {COMPANY_NAME} will not be liable for any indirect,
        incidental, special, consequential, or punitive damages arising from your use of the Service.
      </p>

      <h2>10. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless {COMPANY_NAME} from any claims, liabilities, and
        expenses arising from your use of the Service or your violation of these Terms.
      </p>

      <h2>11. Termination</h2>
      <p>
        We may suspend or terminate access to the Service at any time if we believe you have violated
        these Terms or if required by law.
      </p>

      <h2>12. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. If changes are material, we will provide notice
        by updating the effective date above.
      </p>

      <h2>13. Contact</h2>
      <p>
        If you have questions about these Terms, contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
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
