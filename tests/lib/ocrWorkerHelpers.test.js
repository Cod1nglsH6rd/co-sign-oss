import * as ocrResume from '../../lib/ocrResume';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const STALE_MS = 270000;

function fn(name) {
  expect(typeof ocrResume[name]).toBe('function');
  return ocrResume[name];
}

function doc(ocr, updatedAt) {
  const phase1_data = ocr === null ? { documentType: 'hud1' } : { documentType: 'hud1', ocr };
  return { phase1_data, updated_at: updatedAt };
}

const LONG_AGO = '2026-11-17T11:00:00.000Z'; // one hour before NOW
const RECENT = '2026-11-17T11:59:00.000Z'; // 60s before NOW

describe('isStaleOcrJob', () => {
  it('never treats a done or error job as stale', () => {
    const isStaleOcrJob = fn('isStaleOcrJob');
    expect(isStaleOcrJob(doc({ phase: 'done' }, LONG_AGO), NOW, STALE_MS)).toBe(false);
    expect(isStaleOcrJob(doc({ phase: 'error' }, LONG_AGO), NOW, STALE_MS)).toBe(false);
  });

  it('never treats a job with no ocr state as stale', () => {
    const isStaleOcrJob = fn('isStaleOcrJob');
    expect(isStaleOcrJob(doc(null, LONG_AGO), NOW, STALE_MS)).toBe(false);
    expect(isStaleOcrJob(doc({}, LONG_AGO), NOW, STALE_MS)).toBe(false);
  });

  it('does not treat a job updated inside the window as stale', () => {
    const isStaleOcrJob = fn('isStaleOcrJob');
    expect(isStaleOcrJob(doc({ phase: 'detect' }, RECENT), NOW, STALE_MS)).toBe(false);
    expect(isStaleOcrJob(doc({ phase: 'detect' }, RECENT), NOW)).toBe(false);
  });

  it('treats a non-terminal job past the window as stale', () => {
    const isStaleOcrJob = fn('isStaleOcrJob');
    expect(isStaleOcrJob(doc({ phase: 'enrich' }, LONG_AGO), NOW, STALE_MS)).toBe(true);
    // default window is 270s: 5 minutes idle is past it
    expect(isStaleOcrJob(doc({ phase: 'detect' }, '2026-11-17T11:55:00.000Z'), NOW)).toBe(true);
    // a custom window longer than the idle time keeps it fresh
    expect(isStaleOcrJob(doc({ phase: 'detect' }, '2026-11-17T11:55:00.000Z'), NOW, 600000)).toBe(false);
  });
});

describe('buildClaimPatch', () => {
  it('sets dispatches to 1 when missing and stamps lastDispatchAt', () => {
    const buildClaimPatch = fn('buildClaimPatch');
    const job = { id: 'd1', phase1_data: { documentType: 'hud1', ocr: { phase: 'detect', nextBatch: 2 } } };
    expect(buildClaimPatch(job, NOW)).toEqual({
      phase1_data: {
        documentType: 'hud1',
        ocr: { phase: 'detect', nextBatch: 2, dispatches: 1, lastDispatchAt: '2026-11-17T12:00:00.000Z' },
      },
    });
  });

  it('increments dispatches from 3 to 4 and keeps sibling keys', () => {
    const buildClaimPatch = fn('buildClaimPatch');
    const job = {
      phase1_data: { documentType: 'hud1', parties: ['a'], ocr: { phase: 'enrich', dispatches: 3 } },
    };
    const patch = buildClaimPatch(job, NOW);
    expect(patch.phase1_data.ocr.dispatches).toBe(4);
    expect(patch.phase1_data.ocr.phase).toBe('enrich');
    expect(patch.phase1_data.documentType).toBe('hud1');
    expect(patch.phase1_data.parties).toEqual(['a']);
    expect(job.phase1_data.ocr.dispatches).toBe(3);
  });
});

describe('buildAbandonPatch', () => {
  it('sets all four error fields and keeps sibling keys', () => {
    const buildAbandonPatch = fn('buildAbandonPatch');
    const job = { phase1_data: { documentType: 'hud1', ocr: { phase: 'detect', dispatches: 8 } } };
    expect(buildAbandonPatch(job, NOW)).toEqual({
      phase1_data: {
        documentType: 'hud1',
        ocr: {
          phase: 'error',
          dispatches: 8,
          failedReason: 'max_dispatches',
          updatedAt: '2026-11-17T12:00:00.000Z',
        },
      },
      status: 'error',
      processing_status: 'error',
      metadata: null,
    });
  });
});
