/**
 * By-hand wiring for co-sign-360: instrumentation.js makes the one-time setup
 * code at boot through lib/setupBoot.js, only on the nodejs runtime, in its
 * own try/catch that never stops boot, passing by name exactly the settings
 * setupNeeded reads (VERCEL, ADMIN_DASHBOARD_EMAILS, NEXT_PUBLIC_OWNER_EMAILS)
 * and cwd: process.cwd(). The boot helper is a fake here: no file is made.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SETTINGS = ['VERCEL', 'ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS'];

let mockSetupBootLoads = 0;

jest.mock('../../sentry.server.config', () => ({}));
jest.mock('../../sentry.edge.config', () => ({}));
jest.mock('../../lib/ocrWorkerBoot', () => ({ startOcrWorkerFromEnv: jest.fn(() => null) }));
jest.mock('../../lib/setupBoot', () => {
  mockSetupBootLoads += 1;
  return { ensureSetupCodeAtBoot: jest.fn(() => true) };
});

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

describe('instrumentation.js source: setup code at boot', () => {
  const src = code('instrumentation.js');
  const nodeBlock = ifBlock(src, "process.env.NEXT_RUNTIME === 'nodejs'");
  const edgeBlock = ifBlock(src, "process.env.NEXT_RUNTIME === 'edge'");

  it('imports lib/setupBoot only inside the nodejs runtime guard, after the OCR worker', () => {
    expect(nodeBlock).toMatch(/await import\(\s*['"]\.\/lib\/setupBoot['"]\s*\)/);
    expect(src.match(/setupBoot/g)).toHaveLength(1);
    expect(src.match(/ensureSetupCodeAtBoot\s*\(/g)).toHaveLength(1);
    expect(edgeBlock).not.toMatch(/setupBoot|ensureSetupCodeAtBoot/);
    expect(nodeBlock.indexOf('setupBoot')).toBeGreaterThan(nodeBlock.indexOf('ocrWorkerBoot'));
  });

  it('calls the helper in its own try/catch', () => {
    const tries = [...nodeBlock.matchAll(/try\s*\{([\s\S]*?)\}\s*catch\s*\(/g)].map((m) => m[1]);
    const own = tries.filter((body) => /setupBoot/.test(body));
    expect(own).toHaveLength(1);
    expect(own[0]).not.toMatch(/ocrWorkerBoot/);
  });

  it('passes exactly the setupNeeded settings by name, never process.env whole, and cwd: process.cwd()', () => {
    const call = /ensureSetupCodeAtBoot\s*\(\s*\{([\s\S]*?)\}\s*\)\s*;/.exec(nodeBlock);
    expect(call).not.toBeNull();
    const envBlock = /env:\s*\{([^{}]*)\}/.exec(call[1]);
    expect(envBlock).not.toBeNull();
    const names = [...envBlock[1].matchAll(/([A-Z][A-Z0-9_]*):\s*process\.env\.([A-Z][A-Z0-9_]*)\b/g)];
    expect(names.map((m) => m[1]).sort()).toEqual([...SETTINGS].sort());
    for (const m of names) expect(m[2]).toBe(m[1]);
    expect(call[1]).not.toMatch(/env:\s*process\.env\b/);
    expect(call[1]).toMatch(/cwd:\s*process\.cwd\(\)/);
  });

  it('does not use or log what the helper returns', () => {
    expect(nodeBlock).toMatch(/(^|[;{]\s*|\n\s*)ensureSetupCodeAtBoot\s*\(/);
    expect(nodeBlock).not.toMatch(/=\s*(await\s+)?ensureSetupCodeAtBoot/);
  });
});

describe('instrumentation.js register(): setup code at boot', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    mockSetupBootLoads = 0;
    for (const name of SETTINGS) delete process.env[name];
  });

  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  function load() {
    // eslint-disable-next-line global-require
    const { register } = require('../../instrumentation');
    return { register };
  }

  // The helper module register() imported, once it has run.
  function helper() {
    // eslint-disable-next-line global-require
    return require('../../lib/setupBoot');
  }

  it('calls the helper once on nodejs with the named settings and the working folder', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.VERCEL = '1';
    process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
    process.env.NEXT_PUBLIC_OWNER_EMAILS = 'browser@example.com';
    process.env.COSIGN_UNRELATED_SETTING = 'not passed';
    const { register } = load();
    await register();
    const { ensureSetupCodeAtBoot } = helper();
    expect(ensureSetupCodeAtBoot).toHaveBeenCalledTimes(1);
    const [arg] = ensureSetupCodeAtBoot.mock.calls[0];
    expect(Object.keys(arg).sort()).toEqual(['cwd', 'env']);
    expect(arg.env).toEqual({
      VERCEL: '1',
      ADMIN_DASHBOARD_EMAILS: 'owner@example.com',
      NEXT_PUBLIC_OWNER_EMAILS: 'browser@example.com',
    });
    expect(Object.keys(arg.env).sort()).toEqual([...SETTINGS].sort());
    expect(arg.env).not.toBe(process.env);
    expect(arg.cwd).toBe(process.cwd());
  });

  it('passes the settings as unset on a fresh install', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = load();
    await register();
    const { ensureSetupCodeAtBoot } = helper();
    expect(ensureSetupCodeAtBoot).toHaveBeenCalledTimes(1);
    const { env } = ensureSetupCodeAtBoot.mock.calls[0][0];
    for (const name of SETTINGS) expect(env[name]).toBeUndefined();
  });

  it('never imports the helper on the edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = load();
    await register();
    expect(mockSetupBootLoads).toBe(0);
  });

  it('still resolves, logging one line without a code, when the helper throws', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { ensureSetupCodeAtBoot } = helper();
    ensureSetupCodeAtBoot.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const { register } = load();
    await expect(register()).resolves.toBeUndefined();
    expect(ensureSetupCodeAtBoot).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[instrumentation\] .*disk full$/);
  });

  it('still starts the OCR worker when the helper throws', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    helper().ensureSetupCodeAtBoot.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const { register } = load();
    await register();
    // eslint-disable-next-line global-require
    expect(require('../../lib/ocrWorkerBoot').startOcrWorkerFromEnv).toHaveBeenCalledTimes(1);
  });
});
