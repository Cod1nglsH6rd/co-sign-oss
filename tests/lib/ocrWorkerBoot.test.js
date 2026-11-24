/**
 * lib/ocrWorkerBoot.js: starts the OCR worker loop from an injected env and
 * dispatches parked jobs to the app's own /api/ocr with the per-process
 * internal token. Every dependency is a fake: no network, no database.
 */

jest.mock('../../lib/supabaseClient', () => ({
  requireServiceSupabase: jest.fn(() => {
    throw new Error('Supabase credentials not configured');
  }),
}));

function loadBoot() {
  let mod = {};
  try {
    // eslint-disable-next-line global-require
    mod = require('../../lib/ocrWorkerBoot');
  } catch (e) {
    mod = {};
  }
  expect(typeof mod.startOcrWorkerFromEnv).toBe('function');
  expect(typeof mod.buildLocalOcrDispatch).toBe('function');
  return mod;
}

const fakeLog = () => ({ error: jest.fn(), warn: jest.fn(), log: jest.fn(), info: jest.fn() });
const logLines = (log) => log.error.mock.calls.length + log.warn.mock.calls.length
  + log.log.mock.calls.length + log.info.mock.calls.length;

const fakeLoop = () => {
  const stop = jest.fn();
  const startLoop = jest.fn(() => ({ stop }));
  return { startLoop, stop };
};

// A thenable query builder: every chained call returns itself, awaiting it
// yields `result`.
function chain(result) {
  const b = {};
  ['select', 'not', 'neq', 'lt', 'order', 'limit', 'eq', 'update'].forEach((m) => {
    b[m] = jest.fn(() => b);
  });
  b.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return b;
}

const PENDING_JOB = {
  id: 'doc-1',
  user_id: 'user-9',
  created_by: null,
  preferred_language: 'fr',
  phase1_data: { ocr: { phase: 'running', mode: 'fast', dispatches: 0 } },
  updated_at: '2026-11-17T00:00:00.000Z',
};

function fakeSupabase() {
  const calls = [];
  return {
    calls,
    from: jest.fn((table) => {
      calls.push(table);
      // First call: job query. Later calls: the claim update.
      return calls.length === 1
        ? chain({ data: [PENDING_JOB], error: null })
        : chain({ data: [{ id: PENDING_JOB.id }], error: null });
    }),
  };
}

const NODE_ENV = { NEXT_RUNTIME: 'nodejs' };

describe('startOcrWorkerFromEnv', () => {
  test('OCR_WORKER=off starts nothing and returns null', () => {
    const { startOcrWorkerFromEnv } = loadBoot();
    const { startLoop } = fakeLoop();
    const getSupabase = jest.fn(() => fakeSupabase());
    const result = startOcrWorkerFromEnv({
      env: { ...NODE_ENV, OCR_WORKER: 'off' }, getSupabase, startLoop, log: fakeLog(), fetchImpl: jest.fn(),
    });
    expect(result).toBeNull();
    expect(startLoop).not.toHaveBeenCalled();
  });

  test('a non-nodejs runtime starts nothing and returns null', () => {
    const { startOcrWorkerFromEnv } = loadBoot();
    const { startLoop } = fakeLoop();
    const getSupabase = jest.fn(() => fakeSupabase());
    for (const env of [{ NEXT_RUNTIME: 'edge' }, {}]) {
      const result = startOcrWorkerFromEnv({
        env, getSupabase, startLoop, log: fakeLog(), fetchImpl: jest.fn(),
      });
      expect(result).toBeNull();
    }
    expect(startLoop).not.toHaveBeenCalled();
  });

  test('Supabase not configured logs one line and returns null without throwing', () => {
    const { startOcrWorkerFromEnv } = loadBoot();
    const { startLoop } = fakeLoop();
    const log = fakeLog();
    const getSupabase = jest.fn(() => {
      throw new Error('Supabase credentials not configured');
    });
    let result;
    expect(() => {
      result = startOcrWorkerFromEnv({ env: NODE_ENV, getSupabase, startLoop, log, fetchImpl: jest.fn() });
    }).not.toThrow();
    expect(result).toBeNull();
    expect(startLoop).not.toHaveBeenCalled();
    expect(logLines(log)).toBe(1);
  });

  test('default getSupabase (requireServiceSupabase) throwing also returns null', () => {
    const { startOcrWorkerFromEnv } = loadBoot();
    const { startLoop } = fakeLoop();
    const log = fakeLog();
    const result = startOcrWorkerFromEnv({ env: NODE_ENV, startLoop, log, fetchImpl: jest.fn() });
    expect(result).toBeNull();
    expect(startLoop).not.toHaveBeenCalled();
    expect(logLines(log)).toBe(1);
  });

  test('default interval is 30000 and returns the loop handle', () => {
    const { startOcrWorkerFromEnv } = loadBoot();
    const { startLoop, stop } = fakeLoop();
    const result = startOcrWorkerFromEnv({
      env: NODE_ENV, getSupabase: () => fakeSupabase(), startLoop, log: fakeLog(), fetchImpl: jest.fn(),
    });
    expect(startLoop).toHaveBeenCalledTimes(1);
    expect(startLoop.mock.calls[0][0].intervalMs).toBe(30000);
    expect(typeof startLoop.mock.calls[0][0].tick).toBe('function');
    expect(result).not.toBeNull();
    expect(result.stop).toBe(stop);
  });

  test('OCR_WORKER_INTERVAL_MS overrides the interval', () => {
    const { startOcrWorkerFromEnv } = loadBoot();
    const { startLoop } = fakeLoop();
    startOcrWorkerFromEnv({
      env: { ...NODE_ENV, OCR_WORKER_INTERVAL_MS: '5000' },
      getSupabase: () => fakeSupabase(),
      startLoop,
      log: fakeLog(),
      fetchImpl: jest.fn(),
    });
    expect(startLoop.mock.calls[0][0].intervalMs).toBe(5000);
  });

  test('a pending job given to the tick is dispatched to local /api/ocr, not the cron route', async () => {
    const { startOcrWorkerFromEnv } = loadBoot();
    const { getInternalToken } = require('../../lib/internalAuth');
    const { startLoop } = fakeLoop();
    const supabase = fakeSupabase();
    const fetchImpl = jest.fn(() => Promise.resolve({ ok: true, status: 202 }));
    startOcrWorkerFromEnv({
      env: { ...NODE_ENV, PORT: '4100' }, getSupabase: () => supabase, startLoop, log: fakeLog(), fetchImpl,
    });
    const { tick } = startLoop.mock.calls[0][0];
    await tick();

    expect(supabase.from).toHaveBeenCalledWith('documents');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:4100/api/ocr');
    expect(url).not.toContain('cron');
    expect(init.method).toBe('POST');
    expect(init.headers['x-internal-token']).toBe(getInternalToken());
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      documentId: 'doc-1', userId: 'user-9', mode: 'fast', preferredLanguage: 'fr',
    });
  });
});

describe('buildLocalOcrDispatch', () => {
  test('posts to 127.0.0.1 on the given port with the x-internal-token header', async () => {
    const { buildLocalOcrDispatch } = loadBoot();
    const fetchImpl = jest.fn(() => Promise.resolve({ ok: true }));
    const dispatch = buildLocalOcrDispatch({ port: 3456, token: 'tok-abc', fetchImpl, graceMs: 10 });
    await dispatch({ id: 'd2', user_id: null, created_by: 'c7', preferred_language: null }, {});

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3456/api/ocr');
    expect(init.method).toBe('POST');
    expect(init.headers['x-internal-token']).toBe('tok-abc');
    const headerNames = Object.keys(init.headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain('authorization');
    expect(JSON.parse(init.body)).toEqual({
      documentId: 'd2', userId: 'c7', mode: 'full', preferredLanguage: 'en',
    });
  });

  test('port defaults to 3000', async () => {
    const { buildLocalOcrDispatch } = loadBoot();
    const fetchImpl = jest.fn(() => Promise.resolve({ ok: true }));
    const dispatch = buildLocalOcrDispatch({ token: 't', fetchImpl, graceMs: 10 });
    await dispatch({ id: 'd3', user_id: 'u' }, { mode: 'full' });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/ocr');
  });

  test('does not wait past the grace for a slow fetch', async () => {
    const { buildLocalOcrDispatch } = loadBoot();
    const fetchImpl = jest.fn(() => new Promise(() => {}));
    const dispatch = buildLocalOcrDispatch({ port: 3000, token: 't', fetchImpl, graceMs: 20 });
    await expect(dispatch({ id: 'd4', user_id: 'u' }, {})).resolves.toBeUndefined();
  });

  test('a fetch error is logged, not thrown', async () => {
    const { buildLocalOcrDispatch } = loadBoot();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const dispatch = buildLocalOcrDispatch({ port: 3000, token: 't', fetchImpl, graceMs: 50 });
    await expect(dispatch({ id: 'd5', user_id: 'u' }, {})).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
