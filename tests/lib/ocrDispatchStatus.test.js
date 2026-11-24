/**
 * The local OCR dispatch must treat a non-2xx answer from /api/ocr as a
 * failed dispatch: one log line with the status code, never the token.
 */
import { buildLocalOcrDispatch } from '../../lib/ocrWorkerBoot';

const TOKEN = 'f00dfacecafe0123456789abcdef0123456789abcdef0123456789abcdef0123';
const JOB = { id: 'doc-7', user_id: 'user-3', preferred_language: 'en' };

const fakeLog = () => ({ error: jest.fn(), warn: jest.fn(), log: jest.fn(), info: jest.fn() });
const allCalls = (log) => [
  ...log.error.mock.calls, ...log.warn.mock.calls, ...log.log.mock.calls, ...log.info.mock.calls,
];

function answering(status) {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => '',
  }));
}

async function dispatchWith(status) {
  const log = fakeLog();
  const fetchImpl = answering(status);
  const dispatch = buildLocalOcrDispatch({
    port: 3000, token: TOKEN, fetchImpl, graceMs: 2000, log,
  });
  await expect(dispatch(JOB, { mode: 'full' })).resolves.toBeUndefined();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  return log;
}

describe('buildLocalOcrDispatch response status', () => {
  it.each([401, 500])('reports a %i answer as a failed dispatch in one warn line with the status', async (status) => {
    const log = await dispatchWith(status);
    expect(allCalls(log)).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(log.warn.mock.calls[0]);
    expect(line).toContain(String(status));
    expect(line).toContain(JOB.id);
    expect(line).not.toContain(TOKEN);
  });

  it('reports a 200 answer as a successful dispatch with nothing logged', async () => {
    const log = await dispatchWith(200);
    expect(allCalls(log)).toHaveLength(0);
  });
});
