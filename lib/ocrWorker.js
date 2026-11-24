/**
 * OCR worker core: one pass ("tick") over parked OCR jobs.
 *
 * Picks up documents whose `phase1_data.ocr.phase` is non-terminal and whose
 * `updated_at` is older than the stale window, oldest first. A job that has
 * been dispatched too often is marked error; any other job is claimed with a
 * single conditional update (matching the `updated_at` it was read with), and
 * `dispatch(job, ocr)` runs only when that claim actually wrote a row. Two
 * ticks racing on one job therefore dispatch it once.
 *
 * Returns { dispatched, abandoned, jobs }. A failed job query, claim or
 * abandon update throws (a failed claim is not a lost race); the job stays
 * stuck and the next tick retries it.
 *
 * The Supabase client and dispatch function are injected; nothing here knows
 * about HTTP, cron routes or secrets.
 */
import {
  cronStaleCutoffISO,
  dispatchesExceeded,
  buildClaimPatch,
  buildAbandonPatch,
  DEFAULT_STALE_MS,
  DEFAULT_MAX_DISPATCHES,
} from './ocrResume';

export const DEFAULT_MAX_JOBS = 3;

export async function runOcrTick({
  supabase,
  now = Date.now(),
  dispatch,
  staleMs = DEFAULT_STALE_MS,
  maxJobs = DEFAULT_MAX_JOBS,
  maxDispatches = DEFAULT_MAX_DISPATCHES,
}) {
  const cutoff = cronStaleCutoffISO(now, staleMs);
  const { data, error } = await supabase
    .from('documents')
    .select('id, user_id, created_by, preferred_language, phase1_data, updated_at')
    .not('phase1_data->ocr->>phase', 'is', null)
    .neq('phase1_data->ocr->>phase', 'done')
    .neq('phase1_data->ocr->>phase', 'error')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(maxJobs);
  if (error) throw new Error(`OCR job query failed: ${error.message}`);

  const jobs = data || [];
  let dispatched = 0;
  let abandoned = 0;
  for (const job of jobs) {
    const ocr = (job.phase1_data && job.phase1_data.ocr) || {};

    if (dispatchesExceeded(ocr, maxDispatches)) {
      const { error: abandonError } = await supabase
        .from('documents')
        .update(buildAbandonPatch(job, now))
        .eq('id', job.id);
      if (abandonError) throw new Error(`OCR abandon failed for ${job.id}: ${abandonError.message}`);
      abandoned += 1;
      continue;
    }

    // Claim only if nobody touched the row since we read it.
    const { data: claimed, error: claimError } = await supabase
      .from('documents')
      .update({ ...buildClaimPatch(job, now), updated_at: new Date(now).toISOString() })
      .eq('id', job.id)
      .eq('updated_at', job.updated_at)
      .select();
    if (claimError) throw new Error(`OCR claim failed for ${job.id}: ${claimError.message}`);
    if (!claimed || claimed.length === 0) continue; // another tick won the race

    await dispatch(job, ocr);
    dispatched += 1;
  }

  return { dispatched, abandoned, jobs: jobs.map((j) => j.id) };
}
