import {
  readOcrState,
  isResumableState,
  isLeaseHeld,
  attemptsExceeded,
  dispatchesExceeded,
  mergeOcrState,
  isOverBudget,
  cronStaleCutoffISO,
  OCR_TERMINAL_PHASES,
  DEFAULT_LEASE_MS,
} from '../../lib/ocrResume';

describe('readOcrState', () => {
  it('returns the ocr sub-object or null', () => {
    expect(readOcrState({ phase1_data: { ocr: { phase: 'detect' } } })).toEqual({ phase: 'detect' });
    expect(readOcrState({ phase1_data: {} })).toBeNull();
    expect(readOcrState({})).toBeNull();
    expect(readOcrState(null)).toBeNull();
  });
});

describe('isResumableState', () => {
  it('resumes a non-terminal phase when the mode matches', () => {
    expect(isResumableState({ phase: 'detect', mode: 'full' }, 'full')).toBe(true);
    expect(isResumableState({ phase: 'vision-detect', mode: 'full' }, 'full')).toBe(true);
    expect(isResumableState({ phase: 'enrich', mode: 'full' }, 'full')).toBe(true);
    expect(isResumableState({ phase: 'backfill' }, 'full')).toBe(true); // no stored mode → allow
  });
  it('does not resume terminal phases', () => {
    for (const phase of OCR_TERMINAL_PHASES) {
      expect(isResumableState({ phase, mode: 'full' }, 'full')).toBe(false);
    }
  });
  it('does not resume across a mode mismatch', () => {
    expect(isResumableState({ phase: 'enrich', mode: 'full' }, 'pre_setup')).toBe(false);
    expect(isResumableState({ phase: 'detect', mode: 'pre_setup' }, 'full')).toBe(false);
  });
  it('handles null/empty state', () => {
    expect(isResumableState(null, 'full')).toBe(false);
    expect(isResumableState({}, 'full')).toBe(false);
  });
});

describe('isLeaseHeld', () => {
  const now = 1_000_000;
  it('is held when a recent lease exists', () => {
    expect(isLeaseHeld({ lease: { id: 'a', at: now - 1000 } }, now)).toBe(true);
  });
  it('is not held once the lease is older than the window', () => {
    expect(isLeaseHeld({ lease: { id: 'a', at: now - DEFAULT_LEASE_MS - 1 } }, now)).toBe(false);
  });
  it('is not held with no lease', () => {
    expect(isLeaseHeld({ phase: 'detect' }, now)).toBe(false);
    expect(isLeaseHeld(null, now)).toBe(false);
  });
});

describe('attemptsExceeded', () => {
  it('compares attempts to the max', () => {
    expect(attemptsExceeded({ attempts: 8 }, 8)).toBe(true);
    expect(attemptsExceeded({ attempts: 9 }, 8)).toBe(true);
    expect(attemptsExceeded({ attempts: 2 }, 8)).toBe(false);
    expect(attemptsExceeded({}, 8)).toBe(false);
    expect(attemptsExceeded(null, 8)).toBe(false);
  });
});

describe('dispatchesExceeded', () => {
  it('compares cron dispatches to the max (bounds no-checkpoint loops)', () => {
    expect(dispatchesExceeded({ dispatches: 8 }, 8)).toBe(true);
    expect(dispatchesExceeded({ dispatches: 12 }, 8)).toBe(true);
    expect(dispatchesExceeded({ dispatches: 3 }, 8)).toBe(false);
    expect(dispatchesExceeded({}, 8)).toBe(false);
    expect(dispatchesExceeded(null, 8)).toBe(false);
  });
});

describe('mergeOcrState', () => {
  it('merges the ocr patch while preserving sibling keys', () => {
    const p1 = { documentType: 'lease', parties: ['a'], ocr: { phase: 'detect', nextBatch: 1 } };
    const merged = mergeOcrState(p1, { phase: 'enrich', nextEnrichField: 40 });
    expect(merged.documentType).toBe('lease');
    expect(merged.parties).toEqual(['a']);
    expect(merged.ocr).toEqual({ phase: 'enrich', nextBatch: 1, nextEnrichField: 40 });
  });
  it('works when phase1_data has no ocr yet', () => {
    expect(mergeOcrState({ foo: 1 }, { phase: 'detect' })).toEqual({ foo: 1, ocr: { phase: 'detect' } });
  });
  it('tolerates null/undefined phase1_data', () => {
    expect(mergeOcrState(null, { phase: 'detect' })).toEqual({ ocr: { phase: 'detect' } });
  });
});

describe('isOverBudget', () => {
  it('flags elapsed at or beyond the budget', () => {
    expect(isOverBudget(180000, 180000)).toBe(true);
    expect(isOverBudget(180001, 180000)).toBe(true);
    expect(isOverBudget(179999, 180000)).toBe(false);
  });
});

describe('cronStaleCutoffISO', () => {
  it('returns the ISO timestamp of now minus the stale window', () => {
    const now = Date.parse('2026-06-22T12:00:00.000Z');
    expect(cronStaleCutoffISO(now, 270000)).toBe('2026-06-22T11:55:30.000Z');
  });
});
