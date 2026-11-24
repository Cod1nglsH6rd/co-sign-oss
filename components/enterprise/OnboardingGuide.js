/**
 * OnboardingGuide — step-by-step walkthrough of the enterprise workflow.
 * PRD §2.6: auto-opens on a user's first visit and can be re-opened any time
 * from the profile menu ("Getting started guide"). Steps mirror the canonical
 * pipeline: Upload → Set up → Send → Track.
 */

import { useEffect, useState } from 'react';
import {
  FiArrowLeft, FiArrowRight, FiCheckCircle, FiEdit3, FiSend, FiTrendingUp, FiUploadCloud, FiX,
} from 'react-icons/fi';

export const ONBOARDING_STORAGE_KEY = 'cosign_ent_onboarding_done_v1';
export const ONBOARDING_EVENT = 'cosign:show-onboarding';

const STEPS = [
  {
    icon: FiCheckCircle,
    title: 'Welcome to Co Sign Enterprise',
    body: 'Get documents filled and signed by your clients in four steps. This one-minute guide walks you through the pipeline — you can reopen it any time from your profile menu.',
    hint: null,
  },
  {
    icon: FiUploadCloud,
    title: '1 · Upload a document',
    body: 'Go to All Documents and click "New document" to upload a PDF. Our AI immediately detects every form field — labels, types, and positions — and can translate them into your client\'s language (9 supported).',
    hint: 'Documents → New document',
  },
  {
    icon: FiEdit3,
    title: '2 · Set up the fields',
    body: 'When the document shows "Setup required", click Set up to review the detected fields and drag any that need repositioning. You do this once per document — it then becomes a reusable template.',
    hint: 'Documents → Set up',
  },
  {
    icon: FiSend,
    title: '3 · Send for signature',
    body: 'Create a secure signing link for each recipient. Add their email and last name to require identity verification before the document opens. Links expire automatically.',
    hint: 'Send Links → Send for signature',
  },
  {
    icon: FiTrendingUp,
    title: '4 · Track to completion',
    body: 'Watch status move from Pending to Opened to Completed in real time. Recipients fill and sign in their own language, with an AI assistant explaining any field — and you get the completed, signed PDF.',
    hint: 'Dashboard · Send Links · Recipients',
  },
];

export default function OnboardingGuide() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // First visit: open automatically — but only on the Documents page, which
    // is where the workflow starts. Owners land on Owner Usage (analytics)
    // first; auto-opening the "get documents filled in four steps" guide there
    // is out of context, so we wait until they're on Documents.
    try {
      const onDocuments = typeof window !== 'undefined'
        && window.location.pathname.includes('/enterprise/documents');
      if (onDocuments && !window.localStorage.getItem(ONBOARDING_STORAGE_KEY)) {
        setOpen(true);
      }
    } catch { /* storage unavailable */ }

    // Re-open on demand (profile menu).
    const handler = () => { setStep(0); setOpen(true); };
    window.addEventListener(ONBOARDING_EVENT, handler);
    return () => window.removeEventListener(ONBOARDING_EVENT, handler);
  }, []);

  const close = () => {
    try { window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1'); } catch { /* noop */ }
    setOpen(false);
  };

  if (!open) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="onb-backdrop" role="dialog" aria-modal="true" aria-label="Getting started guide">
      <div className="onb-modal">
        <button className="onb-close" type="button" aria-label="Close guide" onClick={close}>
          <FiX size={16} />
        </button>

        <div className="onb-icon"><Icon size={26} /></div>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        {current.hint && <div className="onb-hint">{current.hint}</div>}

        <div className="onb-dots">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Step ${i + 1}`}
              className={`onb-dot${i === step ? ' active' : ''}`}
              onClick={() => setStep(i)}
            />
          ))}
        </div>

        <div className="onb-actions">
          {step > 0 ? (
            <button className="onb-btn ghost" type="button" onClick={() => setStep((s) => s - 1)}>
              <FiArrowLeft size={13} /> Back
            </button>
          ) : (
            <button className="onb-btn ghost" type="button" onClick={close}>Skip</button>
          )}
          {isLast ? (
            <button className="onb-btn primary" type="button" onClick={close}>
              Get started
            </button>
          ) : (
            <button className="onb-btn primary" type="button" onClick={() => setStep((s) => s + 1)}>
              Next <FiArrowRight size={13} />
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .onb-backdrop {
          position: fixed; inset: 0; z-index: 95;
          background: rgba(12, 18, 24, 0.45);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
        }
        .onb-modal {
          position: relative;
          width: 100%; max-width: 440px;
          background: #fff;
          border-radius: 24px;
          border: 1px solid var(--slateish-200, #dde3e7);
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.25);
          padding: 36px 32px 28px;
          text-align: center;
        }
        .onb-close {
          position: absolute; top: 14px; right: 14px;
          border: none; background: var(--slateish-100, #eef1f3);
          width: 30px; height: 30px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          color: var(--slateish-500, #6f7b84); cursor: pointer;
        }
        .onb-icon {
          width: 56px; height: 56px; margin: 0 auto 18px;
          border-radius: 16px;
          background: var(--brand-50, #eef1fb);
          color: var(--brand-600, #4344b3);
          display: flex; align-items: center; justify-content: center;
        }
        .onb-modal h2 {
          font-size: 19px; font-weight: 800;
          color: var(--slateish-900, #1c2226);
          letter-spacing: -.3px;
        }
        .onb-modal p {
          margin-top: 10px;
          font-size: 13.5px; line-height: 1.6;
          color: var(--slateish-500, #6f7b84);
        }
        .onb-hint {
          display: inline-block; margin-top: 14px;
          padding: 5px 12px; border-radius: 9999px;
          background: var(--brand-50, #eef1fb);
          color: var(--brand-700, #383a93);
          font-size: 11px; font-weight: 700;
        }
        .onb-dots {
          display: flex; justify-content: center; gap: 7px;
          margin-top: 22px;
        }
        .onb-dot {
          width: 7px; height: 7px; border-radius: 50%;
          border: none; padding: 0; cursor: pointer;
          background: var(--slateish-200, #dde3e7);
          transition: all .2s;
        }
        .onb-dot.active {
          background: var(--brand-600, #4344b3);
          width: 18px; border-radius: 9999px;
        }
        .onb-actions {
          display: flex; justify-content: space-between; align-items: center;
          margin-top: 22px;
        }
        .onb-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 9px 20px; border-radius: 9999px;
          font-size: 13px; font-weight: 700; font-family: inherit;
          cursor: pointer; border: none; transition: all .2s;
        }
        .onb-btn.ghost { background: transparent; color: var(--slateish-500, #6f7b84); }
        .onb-btn.ghost:hover { color: var(--slateish-700, #3f4950); }
        .onb-btn.primary { background: var(--brand-600, #4344b3); color: #fff; }
        .onb-btn.primary:hover { background: var(--brand-700, #383a93); }
      `}</style>
    </div>
  );
}
