/**
 * runOcrTick (lib/ocrWorker.js): one pass of the OCR worker loop, driven by an
 * injected Supabase client and dispatch function. No cron route, request
 * object or CRON_SECRET is involved.
 *
 * The fake Supabase client below keeps rows in memory, applies the same
 * filters the query sends (not/neq/lt/eq/order/limit) and records every call,
 * so a filter the worker forgets to send lets a wrong row through.
 */

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const NOW_ISO = '2026-11-17T12:00:00.000Z';
const STALE_MS = 270000; // cutoff = 11:55:30
const LONG_AGO = '2026-11-17T11:00:00.000Z';
const OLDER = '2026-11-17T10:00:00.000Z';
const RECENT = '2026-11-17T11:59:00.000Z';

function loadTick() {
  let mod = {};
  try {
    // eslint-disable-next-line global-require
    mod = require('../../lib/ocrWorker');
  } catch (e) {
    mod = {};
  }
  expect(typeof mod.runOcrTick).toBe('function');
  return mod.runOcrTick;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// Resolves 'phase1_data->ocr->>phase' style paths against a row.
function readPath(row, path) {
  return path.split(/->>?/).reduce((v, key) => (v && typeof v === 'object' ? v[key] : undefined), row);
}

function matches(row, filters) {
  return filters.every((f) => {
    const v = readPath(row, f.column);
    if (f.op === 'eq') return v === f.value;
    if (f.op === 'neq') return v !== undefined && v !== null && v !== f.value;
    if (f.op === 'lt') return v !== undefined && v !== null && v < f.value;
    if (f.op === 'not' && f.operator === 'is' && f.value === null) return v !== undefined && v !== null;
    throw new Error(`fake supabase: unsupported filter ${JSON.stringify(f)}`);
  });
}

/**
 * store: { rows } shared between clients. readRows (optional) lets a client
 * read from a stale snapshot while writing to the live store, which is how a
 * tick that lost a claim race sees the world. failUpdate (optional) returns a
 * Supabase error object for an update query, which then writes nothing.
 */
function makeFakeSupabase(store, { readRows, failUpdate } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      expect(table).toBe('documents');
      const q = { table, filters: [], order: null, limit: null, patch: null, kind: null, returning: false };
      calls.push(q);
      const builder = {
        select(cols) {
          if (q.kind === 'update') q.returning = true;
          else { q.kind = 'select'; q.columns = cols; }
          return builder;
        },
        update(patch) { q.kind = 'update'; q.patch = clone(patch); return builder; },
        not(column, operator, value) { q.filters.push({ op: 'not', column, operator, value }); return builder; },
        neq(column, value) { q.filters.push({ op: 'neq', column, value }); return builder; },
        lt(column, value) { q.filters.push({ op: 'lt', column, value }); return builder; },
        eq(column, value) { q.filters.push({ op: 'eq', column, value }); return builder; },
        order(column, opts) { q.order = { column, ascending: !opts || opts.ascending !== false }; return builder; },
        limit(n) { q.limit = n; return builder; },
        then(resolve, reject) {
          try {
            resolve(run());
          } catch (e) {
            if (reject) reject(e); else throw e;
          }
        },
      };
      function run() {
        if (q.kind === 'select') {
          let rows = (readRows || store.rows).filter((r) => matches(r, q.filters));
          if (q.order) {
            const { column, ascending } = q.order;
            rows = rows.slice().sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
          }
          if (q.limit != null) rows = rows.slice(0, q.limit);
          return { data: clone(rows), error: null };
        }
        if (q.kind === 'update') {
          const error = failUpdate ? failUpdate(q) : null;
          if (error) return { data: null, error };
          const hit = store.rows.filter((r) => matches(r, q.filters));
          hit.forEach((r) => Object.assign(r, clone(q.patch)));
          return { data: q.returning ? clone(hit) : null, error: null };
        }
        throw new Error('fake supabase: unknown query');
      }
      return builder;
    },
  };
  return client;
}

function row(id, ocr, updatedAt) {
  return {
    id,
    user_id: 'user-1',
    created_by: null,
    preferred_language: 'en',
    phase1_data: ocr === null ? { documentType: 'hud1' } : { documentType: 'hud1', ocr },
    updated_at: updatedAt,
  };
}

function recordingDispatch() {
  const seen = [];
  const dispatch = async (job, ocr) => { seen.push({ id: job.id, ocr }); };
  dispatch.seen = seen;
  return dispatch;
}

const baseArgs = { now: NOW, staleMs: STALE_MS, maxJobs: 10, maxDispatches: 8 };

describe('runOcrTick', () => {
  it('dispatches a stuck job past the stale window and claims it with a conditional update', async () => {
    const runOcrTick = loadTick();
    const store = { rows: [row('doc-1', { phase: 'detect', dispatches: 2, mode: 'full' }, LONG_AGO)] };
    const supabase = makeFakeSupabase(store);
    const dispatch = recordingDispatch();

    const result = await runOcrTick({ supabase, dispatch, ...baseArgs });

    expect(result).toEqual({ dispatched: 1, abandoned: 0, jobs: ['doc-1'] });
    expect(dispatch.seen).toHaveLength(1);
    expect(dispatch.seen[0].id).toBe('doc-1');
    expect(dispatch.seen[0].ocr).toEqual({ phase: 'detect', dispatches: 2, mode: 'full' });

    const claim = supabase.calls.find((c) => c.kind === 'update');
    expect(claim.filters).toEqual([
      { op: 'eq', column: 'id', value: 'doc-1' },
      { op: 'eq', column: 'updated_at', value: LONG_AGO },
    ]);
    expect(claim.returning).toBe(true);
    expect(claim.patch.updated_at).toBe(NOW_ISO);

    // The claim landed: dispatches bumped, updated_at moved to now.
    expect(store.rows[0].updated_at).toBe(NOW_ISO);
    expect(store.rows[0].phase1_data.ocr.dispatches).toBe(3);
    expect(store.rows[0].phase1_data.ocr.lastDispatchAt).toBe(NOW_ISO);
    expect(store.rows[0].phase1_data.documentType).toBe('hud1');
  });

  it('when two ticks race on the same job, only the tick whose claim returns a row dispatches', async () => {
    const runOcrTick = loadTick();
    const store = { rows: [row('doc-1', { phase: 'enrich', dispatches: 0 }, LONG_AGO)] };
    const snapshot = clone(store.rows); // what the slower tick read before the first one claimed

    const fastDispatch = recordingDispatch();
    const fast = await runOcrTick({ supabase: makeFakeSupabase(store), dispatch: fastDispatch, ...baseArgs });

    const slowDispatch = recordingDispatch();
    const slowClient = makeFakeSupabase(store, { readRows: snapshot });
    const slow = await runOcrTick({ supabase: slowClient, dispatch: slowDispatch, ...baseArgs });

    expect(fast.dispatched).toBe(1);
    expect(fastDispatch.seen.map((d) => d.id)).toEqual(['doc-1']);

    // The slow tick did see the job, tried to claim it, and lost.
    expect(slowClient.calls.filter((c) => c.kind === 'update')).toHaveLength(1);
    expect(slow).toEqual({ dispatched: 0, abandoned: 0, jobs: ['doc-1'] });
    expect(slowDispatch.seen).toEqual([]);

    // Only one claim was written.
    expect(store.rows[0].phase1_data.ocr.dispatches).toBe(1);
  });

  it('marks a job at maxDispatches as error and does not dispatch it', async () => {
    const runOcrTick = loadTick();
    const store = { rows: [row('doc-9', { phase: 'detect', dispatches: 8 }, LONG_AGO)] };
    const supabase = makeFakeSupabase(store);
    const dispatch = recordingDispatch();

    const result = await runOcrTick({ supabase, dispatch, ...baseArgs });

    expect(result).toEqual({ dispatched: 0, abandoned: 1, jobs: ['doc-9'] });
    expect(dispatch.seen).toEqual([]);
    const updates = supabase.calls.filter((c) => c.kind === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toEqual([{ op: 'eq', column: 'id', value: 'doc-9' }]);
    expect(store.rows[0].status).toBe('error');
    expect(store.rows[0].processing_status).toBe('error');
    expect(store.rows[0].phase1_data.ocr.phase).toBe('error');
    expect(store.rows[0].phase1_data.ocr.failedReason).toBe('max_dispatches');
    expect(store.rows[0].phase1_data.ocr.dispatches).toBe(8);
  });

  it('never picks a done or error job, a job with no ocr state, or one updated recently', async () => {
    const runOcrTick = loadTick();
    const store = {
      rows: [
        row('done', { phase: 'done' }, LONG_AGO),
        row('error', { phase: 'error' }, LONG_AGO),
        row('no-ocr', null, LONG_AGO),
        row('recent', { phase: 'detect' }, RECENT),
        row('stuck', { phase: 'detect' }, LONG_AGO),
      ],
    };
    const supabase = makeFakeSupabase(store);
    const dispatch = recordingDispatch();

    const result = await runOcrTick({ supabase, dispatch, ...baseArgs });

    expect(result.jobs).toEqual(['stuck']);
    expect(dispatch.seen.map((d) => d.id)).toEqual(['stuck']);
    const untouched = store.rows.filter((r) => r.id !== 'stuck');
    untouched.forEach((r) => expect(r.phase1_data.ocr && r.phase1_data.ocr.dispatches).toBeFalsy());
    expect(store.rows.find((r) => r.id === 'recent').updated_at).toBe(RECENT);
  });

  it('takes the oldest stuck jobs first, at most maxJobs', async () => {
    const runOcrTick = loadTick();
    const store = {
      rows: [
        row('newer', { phase: 'detect' }, LONG_AGO),
        row('oldest', { phase: 'detect' }, OLDER),
      ],
    };
    const dispatch = recordingDispatch();

    const result = await runOcrTick({ supabase: makeFakeSupabase(store), dispatch, ...baseArgs, maxJobs: 1 });

    expect(result.jobs).toEqual(['oldest']);
    expect(dispatch.seen.map((d) => d.id)).toEqual(['oldest']);
  });

  it('throws when the claim update fails, rather than treating it as a lost race, and does not dispatch', async () => {
    const runOcrTick = loadTick();
    const store = { rows: [row('broken', { phase: 'detect' }, LONG_AGO)] };
    const supabase = makeFakeSupabase(store, { failUpdate: () => ({ message: 'connection reset' }) });
    const dispatch = recordingDispatch();

    await expect(runOcrTick({ supabase, dispatch, ...baseArgs })).rejects.toThrow('connection reset');
    expect(dispatch.seen).toEqual([]);
  });

  it('throws when the abandon update fails, rather than reporting the job as abandoned', async () => {
    const runOcrTick = loadTick();
    const store = { rows: [row('doc-9', { phase: 'detect', dispatches: 8 }, LONG_AGO)] };
    const supabase = makeFakeSupabase(store, { failUpdate: () => ({ message: 'permission denied' }) });
    const dispatch = recordingDispatch();

    await expect(runOcrTick({ supabase, dispatch, ...baseArgs })).rejects.toThrow('permission denied');
    expect(dispatch.seen).toEqual([]);
    expect(store.rows[0].phase1_data.ocr.phase).toBe('detect');
  });

  it('throws when the job query itself fails', async () => {
    const runOcrTick = loadTick();
    const supabase = {
      from() {
        const b = {
          select: () => b, not: () => b, neq: () => b, lt: () => b, order: () => b,
          limit: () => Promise.resolve({ data: null, error: { message: 'db down' } }),
        };
        return b;
      },
    };
    const dispatch = recordingDispatch();

    await expect(runOcrTick({ supabase, dispatch, ...baseArgs })).rejects.toThrow('db down');
    expect(dispatch.seen).toEqual([]);
  });
});
