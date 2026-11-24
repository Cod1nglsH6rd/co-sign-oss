import { useEffect, useMemo, useRef, useState } from 'react';
import { FiFileText, FiUploadCloud } from 'react-icons/fi';

export default function EnterpriseUploadModal({
  open,
  onClose,
  onConfirm,
  initialDocType = 'document',
  uploading = false,
}) {
  const [step, setStep] = useState('form');
  const [docType, setDocType] = useState('document');
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [addAsTemplate, setAddAsTemplate] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStep('form');
    setDocType(initialDocType);
    setFile(null);
    setFileName('');
    setAddAsTemplate(false);
  }, [open, initialDocType]);

  const isTemplate = docType === 'template';
  const effectiveAddAsTemplate = isTemplate ? true : addAsTemplate;

  const summary = useMemo(() => {
    if (!file) return null;
    return {
      fileName: fileName || file.name,
      typeLabel: isTemplate ? 'Template' : 'New Document',
      addAsTemplate: effectiveAddAsTemplate,
    };
  }, [file, fileName, isTemplate, effectiveAddAsTemplate]);

  const handleFilePick = (event) => {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    setFileName(selected?.name || '');
  };

  const handleContinue = () => {
    if (!file) return;
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!file) return;
    await onConfirm({
      file,
      fileName: fileName || file.name,
      docType,
      addAsTemplate: effectiveAddAsTemplate,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !uploading) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const firstFocusable = cardRef.current?.querySelector('button, input, select, textarea');
    firstFocusable?.focus?.();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, uploading]);

  if (!open) return null;

  return (
    <div className="ent-modal-overlay" role="dialog" aria-modal="true">
      <div className="ent-modal-card" ref={cardRef}>
        {/* Header */}
        <div className="ent-modal-header">
          <div>
            <div className="ent-step-badge">{step === 'form' ? 'Step 1 of 2' : 'Step 2 of 2'}</div>
            <div className="ent-modal-title">New Document</div>
            <div className="ent-modal-subtitle">Choose what you want to upload and confirm details.</div>
          </div>
          <button className="ent-modal-close" onClick={onClose} disabled={uploading} aria-label="Close">
            ×
          </button>
        </div>

        {step === 'form' && (
          <div className="ent-modal-body">
            <div className="ent-toggle-row">
              <button
                className={`ent-toggle-btn ${docType === 'document' ? 'active' : ''}`}
                onClick={() => setDocType('document')}
                type="button"
              >
                New Document
              </button>
              <button
                className={`ent-toggle-btn ${docType === 'template' ? 'active' : ''}`}
                onClick={() => setDocType('template')}
                type="button"
              >
                Template
              </button>
            </div>

            <label className="ent-field">
              <span className="ent-field-label">PDF or Photo</span>
              <div className="ent-file-drop">
                {file ? (
                  <div className="ent-file-chosen">
                    <span className="ent-file-icon"><FiFileText size={18} /></span>
                    <div>
                      <div className="ent-file-name">{file.name}</div>
                      <div className="ent-file-size">{(file.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <button className="ent-file-remove" onClick={(e) => { e.preventDefault(); setFile(null); setFileName(''); }}>×</button>
                  </div>
                ) : (
                  <div className="ent-file-placeholder">
                    <span className="ent-file-icon-lg"><FiUploadCloud size={26} /></span>
                    <span className="ent-file-cta">Click to select a PDF or photo</span>
                    <span className="ent-file-hint">or drag and drop</span>
                  </div>
                )}
                <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={handleFilePick} className="ent-file-input" />
              </div>
            </label>

            <label className="ent-field">
              <span className="ent-field-label">File Name</span>
              <input
                type="text"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder="Enter a file name"
                className="ent-text-input"
              />
            </label>

            {!isTemplate && (
              <label className="ent-checkbox">
                <input
                  type="checkbox"
                  checked={addAsTemplate}
                  onChange={(event) => setAddAsTemplate(event.target.checked)}
                />
                <span>Also save as a reusable template</span>
              </label>
            )}
          </div>
        )}

        {step === 'confirm' && summary && (
          <div className="ent-modal-body">
            <div className="ent-confirm-card">
              <div className="ent-confirm-row">
                <div className="ent-confirm-label">File Name</div>
                <div className="ent-confirm-value">{summary.fileName}</div>
              </div>
              <div className="ent-confirm-divider" />
              <div className="ent-confirm-row">
                <div className="ent-confirm-label">Type</div>
                <div className="ent-confirm-value">{summary.typeLabel}</div>
              </div>
              <div className="ent-confirm-divider" />
              <div className="ent-confirm-row">
                <div className="ent-confirm-label">Save as Template</div>
                <div className="ent-confirm-value">{summary.addAsTemplate ? 'Yes' : 'No'}</div>
              </div>
            </div>
          </div>
        )}

        <div className="ent-modal-footer">
          <button className="ent-btn secondary" onClick={step === 'confirm' ? () => setStep('form') : onClose} disabled={uploading}>
            {step === 'confirm' ? '← Back' : 'Cancel'}
          </button>
          {step === 'form' && (
            <button className="ent-btn primary" onClick={handleContinue} disabled={!file || uploading}>
              Continue
            </button>
          )}
          {step === 'confirm' && (
            <button className="ent-btn primary" onClick={handleConfirm} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Confirm & Upload'}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .ent-modal-overlay {
          position: fixed; inset: 0; z-index: 1200; padding: 24px;
          background: rgba(7, 50, 68, 0.6);
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(4px);
        }
        .ent-modal-card {
          width: 100%; max-width: 500px; background: #fff;
          border-radius: 16px; border: 1px solid var(--slateish-200, #dde3e7);
          box-shadow: 0 24px 60px rgba(7,50,68,.18);
          display: flex; flex-direction: column;
        }

        /* Header */
        .ent-modal-header {
          padding: 24px 24px 0; display: flex;
          justify-content: space-between; align-items: flex-start; gap: 12px;
        }
        .ent-step-badge {
          display: inline-block; font-size: 11px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.5px;
          color: var(--brand-600, #4344b3); background: var(--brand-50, #eef1fb);
          border: 1px solid var(--brand-100, #dfe4f7);
          padding: 3px 10px; border-radius: 100px; margin-bottom: 10px;
        }
        .ent-modal-title {
          font-size: 20px; font-weight: 700; color: var(--slateish-900, #1c2226);
        }
        .ent-modal-subtitle {
          font-size: 13px; color: var(--slateish-500, #6f7b84); margin-top: 4px;
        }
        .ent-modal-close {
          width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--slateish-200, #dde3e7);
          background: #fff; cursor: pointer; color: var(--slateish-500, #6f7b84);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; transition: all .15s; flex-shrink: 0;
        }
        .ent-modal-close:hover { background: var(--slateish-50, #f7f9fa); border-color: var(--slateish-300, #c6d0d6); }

        /* Body */
        .ent-modal-body { padding: 24px; display: grid; gap: 20px; }

        /* Toggle */
        .ent-toggle-row {
          display: inline-flex; background: var(--slateish-100, #eef1f3);
          border-radius: 10px; padding: 4px; gap: 4px;
        }
        .ent-toggle-btn {
          border: none; background: transparent; padding: 9px 20px;
          border-radius: 8px; font-weight: 600; font-size: 13px;
          color: var(--slateish-500, #6f7b84); cursor: pointer; transition: all .2s;
          font-family: inherit;
        }
        .ent-toggle-btn.active {
          background: #fff; color: var(--slateish-900, #1c2226);
          box-shadow: 0 2px 8px rgba(0,0,0,.06);
        }

        /* Fields */
        .ent-field { display: grid; gap: 6px; }
        .ent-field-label {
          font-size: 13px; font-weight: 600; color: var(--slateish-700, #3f4950);
        }
        .ent-text-input {
          width: 100%; padding: 11px 14px; border-radius: 8px;
          border: 1px solid var(--slateish-300, #c6d0d6); font-size: 14px;
          font-family: inherit; color: var(--slateish-900, #1c2226);
          background: #fff; outline: none; transition: all .2s;
        }
        .ent-text-input:focus {
          border-color: var(--brand-500, #545fcb);
          box-shadow: 0 0 0 3px rgba(84,95,203,.1);
        }
        .ent-text-input::placeholder { color: var(--slateish-400, #9aa7b0); }

        /* File drop */
        .ent-file-drop {
          position: relative; border: 2px dashed var(--slateish-300, #c6d0d6);
          border-radius: 12px; transition: border-color .2s; cursor: pointer;
        }
        .ent-file-drop:hover { border-color: var(--brand-400, #7782da); }
        .ent-file-input {
          position: absolute; inset: 0; opacity: 0; cursor: pointer;
        }
        .ent-file-placeholder {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 28px 16px; gap: 4px;
        }
        .ent-file-icon-lg { display: inline-flex; color: var(--brand-500, #545fcb); margin-bottom: 4px; }
        .ent-file-cta { font-size: 13px; font-weight: 600; color: var(--brand-600, #4344b3); }
        .ent-file-hint { font-size: 11px; color: var(--slateish-400, #9aa7b0); }
        .ent-file-chosen {
          display: flex; align-items: center; gap: 12px; padding: 14px 16px;
        }
        .ent-file-icon { font-size: 24px; }
        .ent-file-name { font-size: 13px; font-weight: 600; color: var(--slateish-800, #2b3338); }
        .ent-file-size { font-size: 11px; color: var(--slateish-400, #9aa7b0); margin-top: 2px; }
        .ent-file-remove {
          margin-left: auto; width: 24px; height: 24px; border-radius: 6px;
          border: 1px solid var(--slateish-200, #dde3e7); background: #fff;
          cursor: pointer; font-size: 11px; color: var(--slateish-500, #6f7b84);
          display: flex; align-items: center; justify-content: center;
          position: relative; z-index: 2;
        }
        .ent-file-remove:hover { background: var(--slateish-50, #f7f9fa); }

        /* Checkbox */
        .ent-checkbox {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; color: var(--slateish-600, #556068); cursor: pointer;
          background: var(--slateish-50, #f7f9fa); border: 1px solid var(--slateish-100, #eef1f3);
          border-radius: 8px; padding: 10px 14px;
        }
        .ent-checkbox input { accent-color: var(--brand-600, #4344b3); width: 16px; height: 16px; }

        /* Confirm */
        .ent-confirm-card {
          border: 1px solid var(--slateish-200, #dde3e7);
          border-radius: 12px; background: var(--slateish-50, #f7f9fa); overflow: hidden;
        }
        .ent-confirm-row { padding: 14px 18px; }
        .ent-confirm-divider { height: 1px; background: var(--slateish-200, #dde3e7); }
        .ent-confirm-label {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
          font-weight: 700; color: var(--slateish-400, #9aa7b0);
        }
        .ent-confirm-value {
          font-size: 14px; font-weight: 600; color: var(--slateish-800, #2b3338); margin-top: 4px;
        }

        /* Footer */
        .ent-modal-footer {
          display: flex; justify-content: flex-end; gap: 10px;
          padding: 0 24px 24px; margin-top: 4px;
        }

        /* Buttons */
        .ent-btn {
          padding: 11px 22px; border-radius: 8px; font-size: 14px;
          font-weight: 600; font-family: inherit; cursor: pointer;
          transition: all .2s; border: none;
        }
        .ent-btn.primary {
          background: var(--brand-900, #262a5c); color: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,.1);
        }
        .ent-btn.primary:hover { background: var(--brand-800, #2e3175); }
        .ent-btn.primary:disabled {
          background: var(--slateish-200, #dde3e7); color: var(--slateish-400, #9aa7b0);
          box-shadow: none; cursor: not-allowed;
        }
        .ent-btn.secondary {
          background: #fff; color: var(--slateish-700, #3f4950);
          border: 1px solid var(--slateish-300, #c6d0d6);
        }
        .ent-btn.secondary:hover { background: var(--slateish-50, #f7f9fa); border-color: var(--slateish-400, #9aa7b0); }

        @media (max-width: 560px) {
          .ent-modal-card { max-width: 100%; }
          .ent-toggle-row { width: 100%; }
          .ent-toggle-btn { flex: 1; }
        }
      `}</style>
    </div>
  );
}
