/**
 * By-hand wiring for co-sign-258 and 259: instrumentation.js starts the
 * in-process OCR worker at boot through lib/ocrWorkerBoot.js (only on the
 * nodejs runtime, never crashing boot), and vercel.json no longer schedules
 * /api/cron/process-ocr while keeping the retention cron and the git block.
 * The boot helper itself is a fake here: no timers, network or database.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

jest.mock('../../sentry.server.config', () => ({}));
jest.mock('../../sentry.edge.config', () => ({}));
jest.mock('../../lib/ocrWorkerBoot', () => ({ startOcrWorkerFromEnv: jest.fn(() => null) }));
// register() also makes the setup code (tests/lib/instrumentationSetupCode.test.js);
// faked here so these tests make no .cosign/setup-code and log no code.
jest.mock('../../lib/setupBoot', () => ({ ensureSetupCodeAtBoot: jest.fn(() => false) }));

// The source with block and line comments removed.
function code(file) {
  return fs
    .readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// The body of the first `if (<cond>) { ... }` block, by brace matching.
function ifBlock(text, cond) {
  const at = text.indexOf(`if (${cond})`);
  expect(at).not.toBe(-1);
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') depth -= 1;
    if (depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`unclosed block after if (${cond})`);
}

describe('instrumentation.js source', () => {
  const src = code('instrumentation.js');
  const nodeBlock = ifBlock(src, "process.env.NEXT_RUNTIME === 'nodejs'");
  const edgeBlock = ifBlock(src, "process.env.NEXT_RUNTIME === 'edge'");

  it('imports the boot helper and calls it only inside the nodejs runtime guard', () => {
    expect(nodeBlock).toMatch(/await import\(\s*['"]\.\/lib\/ocrWorkerBoot['"]\s*\)/);
    expect(nodeBlock).toMatch(/startOcrWorkerFromEnv\s*\(/);
    expect(src.match(/ocrWorkerBoot/g)).toHaveLength(1);
    expect(edgeBlock).not.toMatch(/ocrWorker/);
  });

  it('passes the worker settings from process.env', () => {
    for (const name of ['NEXT_RUNTIME', 'OCR_WORKER', 'OCR_WORKER_INTERVAL_MS', 'PORT']) {
      expect(nodeBlock).toMatch(new RegExp(`${name}:\\s*process\\.env\\.${name}\\b`));
    }
  });

  it('wraps the worker start in try/catch and keeps the Sentry imports', () => {
    expect(nodeBlock).toMatch(/try\s*\{[\s\S]*ocrWorkerBoot[\s\S]*\}\s*catch\s*\(/);
    expect(nodeBlock).toMatch(/import\(\s*['"]\.\/sentry\.server\.config['"]\s*\)/);
    expect(edgeBlock).toMatch(/import\(\s*['"]\.\/sentry\.edge\.config['"]\s*\)/);
  });
});

describe('instrumentation.js register()', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    jest.clearAllMocks();
  });

  // register() reads process.env when it runs, so one module load serves
  // every case.
  function load() {
    // eslint-disable-next-line global-require
    const { register } = require('../../instrumentation');
    // eslint-disable-next-line global-require
    const boot = require('../../lib/ocrWorkerBoot');
    return { register, boot };
  }

  it('starts the OCR worker on nodejs with the settings from process.env', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.OCR_WORKER = 'on';
    process.env.OCR_WORKER_INTERVAL_MS = '1234';
    process.env.PORT = '4000';
    const { register, boot } = load();
    await register();
    expect(boot.startOcrWorkerFromEnv).toHaveBeenCalledTimes(1);
    expect(boot.startOcrWorkerFromEnv.mock.calls[0][0].env).toEqual({
      NEXT_RUNTIME: 'nodejs',
      OCR_WORKER: 'on',
      OCR_WORKER_INTERVAL_MS: '1234',
      PORT: '4000',
    });
  });

  it('does not start the OCR worker on the edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register, boot } = load();
    await register();
    expect(boot.startOcrWorkerFromEnv).not.toHaveBeenCalled();
  });

  it('logs one line and still resolves when the boot helper throws', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { register, boot } = load();
    boot.startOcrWorkerFromEnv.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(register()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/OCR worker not started: boom/);
    warn.mockRestore();
  });
});

describe('vercel.json', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const crons = config.crons || [];

  it('has no process-ocr cron', () => {
    expect(crons.filter((c) => /process-ocr/.test(c.path))).toEqual([]);
  });

  it('keeps the daily retention cron', () => {
    expect(crons).toContainEqual({ path: '/api/cron/retention', schedule: '0 3 * * *' });
  });

  it('keeps Vercel git deployments off', () => {
    expect(config.git).toEqual({ deploymentEnabled: false });
  });
});
