/**
 * Enterprise landing page: what the app is and a link to sign in.
 * Cô Sign is a self-hosted app released under the MIT License, so this page
 * makes no compliance, pricing or sales claim on behalf of whoever runs it.
 */

import Head from 'next/head';
import Link from 'next/link';
import { FiArrowRight } from 'react-icons/fi';

export default function EnterpriseLanding() {
  return (
    <>
      <Head>
        <title>Cô Sign Enterprise</title>
        <meta
          name="description"
          content="Cô Sign is a self-hosted e-signing app: upload a PDF or a photo of a form, have its fields found, send signing links in nine languages, and get the signed PDF back."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="min-h-screen bg-slateish-50 flex items-center justify-center px-4 py-16">
        <div className="max-w-xl w-full bg-white rounded-2xl shadow-sm border border-slateish-200 p-8 sm:p-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/cosign-logo.png" alt="Cô Sign" style={{ height: 40, width: 'auto' }} />
          <h1 className="mt-6 text-3xl font-bold text-slateish-900">Cô Sign for organisations</h1>
          <p className="mt-4 text-slateish-600 leading-relaxed">
            Upload a PDF or a photo of a form, check the fields it finds, send signing links in nine
            languages, and get the signed PDF back.
          </p>
          <p className="mt-3 text-slateish-600 leading-relaxed">
            Cô Sign is a self-hosted app: it runs on the server of whoever set it up, under the MIT License.
          </p>
          <Link
            href="/enterprise/login"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 font-semibold text-white hover:bg-brand-700"
          >
            Sign in <FiArrowRight size={16} />
          </Link>
        </div>
      </main>
    </>
  );
}
