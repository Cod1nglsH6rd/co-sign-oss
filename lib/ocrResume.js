/**
 * Resumable OCR state helpers (pure, unit-testable).
 *
 * Very dense documents (e.g. a ~375-field HUD-1 on the text-layer path) can't
 * finish OCR within one Vercel function invocation. To survive that, the OCR
 * handler runs under a soft wall-clock budget: when the budget is exceeded it
 * persists progress into `documents.phase1_data.ocr` and returns "in progress"
 * instead of being killed mid-run. The in-process OCR worker (lib/ocrWorker,
 * started at boot by lib/ocrWorkerBoot) later re-invokes the handler, which
 * resumes from the saved checkpoint.
 *
 * Normal documents finish in the first call, never cross the budget, and never
 * write any `ocr` state — so their behaviour is unchanged and the worker never
 * selects them (its query requires a non-null, non-terminal `ocr.phase`).
 *
 * Shape of `phase1_data.ocr`:
 *   {
 *     phase: 'detect' | 'enrich' | 'backfill' | 'done' | 'error',
 *     mode,                 // guard: only resume the same mode
 *     extractionMethod,     // so resume skips re-classification
 *     allAiFields,          // raw detected fields (detect phase only)
 *     nextBatch,            // next text-layer batch index (detect phase)
 *     fields,               // working field array (enrich/backfill phases)
 *     nextEnrichField,      // index into `fields` for enrichment chunking
 *     attempts,             // number of times a worker has parked this job
 *     lease: { id, at },    // soft lock so two workers don't double-drive
 *     updatedAt,            // ISO, last checkpoint write
 *   }
 */

export const OCR_TERMINAL_PHASES = ['done', 'error'];
export const DEFAULT_SOFT_BUDGET_MS = 180000; // 180s; < the 300s Vercel ceiling
export const DEFAULT_LEASE_MS = 120000; // 120s; a fresh lease means a live worker
export const DEFAULT_STALE_MS = 270000; // the worker only adopts jobs idle this long
export const DEFAULT_MAX_ATTEMPTS = 8; // give up (and stop resuming) after this
export const DEFAULT_MAX_DISPATCHES = 8; // the worker gives up dispatching after this

export function readOcrState(doc) {
  return (doc && doc.phase1_data && doc.phase1_data.ocr) || null;
}

/**
 * A checkpointed job we should resume (vs. start fresh). Only resume when the
 * persisted mode matches — a doc parked mid-`pre_setup` must not resume as
 * `full` (different terminal states + email side effects).
 */
export function isResumableState(ocrState, mode) {
  return !!(
    ocrState &&
    typeof ocrState.phase === 'string' &&
    !OCR_TERMINAL_PHASES.includes(ocrState.phase) &&
    (!ocrState.mode || ocrState.mode === mode)
  );
}

/**
 * True if another worker holds a fresh lease — caller should back off. The
 * first (user-initiated) invocation has no prior state and so no lease.
 */
export function isLeaseHeld(ocrState, now, leaseMs = DEFAULT_LEASE_MS) {
  const at = ocrState && ocrState.lease ? Number(ocrState.lease.at) : NaN;
  if (!Number.isFinite(at)) return false;
  return now - at < leaseMs;
}

export function attemptsExceeded(ocrState, max = DEFAULT_MAX_ATTEMPTS) {
  return Number((ocrState && ocrState.attempts) || 0) >= max;
}

/**
 * Give-up check owned by the in-process OCR worker. Unlike `attempts`
 * (incremented only when the OCR handler writes a checkpoint), `dispatches` is
 * incremented by the worker every time it fires the handler — so it bounds retries even when the worker is
 * hard-killed before it can checkpoint (e.g. a pathologically slow prep step).
 */
export function dispatchesExceeded(ocrState, max = DEFAULT_MAX_DISPATCHES) {
  return Number((ocrState && ocrState.dispatches) || 0) >= max;
}

/**
 * Read-modify-write merge of an `ocr` patch into a `phase1_data` object,
 * preserving sibling keys (documentType, parties, setupCompleted, …).
 */
export function mergeOcrState(phase1Data, patch) {
  const base = phase1Data && typeof phase1Data === 'object' ? phase1Data : {};
  const prevOcr = base.ocr && typeof base.ocr === 'object' ? base.ocr : {};
  return { ...base, ocr: { ...prevOcr, ...patch } };
}

export function isOverBudget(elapsedMs, budgetMs = DEFAULT_SOFT_BUDGET_MS) {
  return elapsedMs >= budgetMs;
}

/** ISO cutoff for the worker's "idle long enough to adopt" filter. */
export function cronStaleCutoffISO(now, staleMs = DEFAULT_STALE_MS) {
  return new Date(now - staleMs).toISOString();
}

/**
 * True when a non-terminal OCR job has sat idle (by `updated_at`) longer than
 * `staleMs` — i.e. no live worker is driving it and it can be adopted.
 */
export function isStaleOcrJob(doc, now, staleMs = DEFAULT_STALE_MS) {
  const ocr = readOcrState(doc);
  if (!ocr || typeof ocr.phase !== 'string' || OCR_TERMINAL_PHASES.includes(ocr.phase)) return false;
  return Date.parse(doc.updated_at) < now - staleMs;
}

/** Row patch a worker writes when it claims a job: bump `dispatches`. */
export function buildClaimPatch(job, now) {
  const ocr = readOcrState(job) || {};
  return {
    phase1_data: mergeOcrState(job && job.phase1_data, {
      dispatches: (ocr.dispatches || 0) + 1,
      lastDispatchAt: new Date(now).toISOString(),
    }),
  };
}

/** Row patch that gives up on a job after too many dispatches. */
export function buildAbandonPatch(job, now) {
  return {
    phase1_data: mergeOcrState(job && job.phase1_data, {
      phase: 'error',
      failedReason: 'max_dispatches',
      updatedAt: new Date(now).toISOString(),
    }),
    status: 'error',
    processing_status: 'error',
    metadata: null,
  };
}
