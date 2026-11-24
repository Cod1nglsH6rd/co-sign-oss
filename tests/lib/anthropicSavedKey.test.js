/**
 * lib/anthropic.js builds its Anthropic client on first use, from
 * effectiveSetting('ANTHROPIC_API_KEY') (env first, then the key saved at
 * setup in .cosign/settings.json), and builds a new client when that key
 * changes, so a key saved at setup works without a restart.
 * GET /api/health reports Anthropic as configured when only a saved key
 * exists, and never includes the key or its mask.
 * The SDK and Supabase are mocked; every test runs in its own temp folder.
 * The key values are made-up placeholders.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('@anthropic-ai/sdk', () => {
  const Anthropic = jest.fn(function Anthropic(options) {
    this.apiKey = options.apiKey;
    this.messages = {
      create: jest.fn(async () => ({
        content: [{ type: 'text', text: 'reply' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
    };
  });
  return { __esModule: true, default: Anthropic };
});

jest.mock('../../lib/supabaseClient', () => ({
  requireServiceSupabase: () => ({
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
  }),
}));

const SAVED_KEY = 'fake-saved-key-NOT-REAL-aaaaQWXZ';
const OTHER_SAVED_KEY = 'fake-saved-key-NOT-REAL-bbbbJKLV';
const ENV_KEY = 'fake-env-key-NOT-REAL-ccccMNPR';

let cwd;
let savedEnvKey;

beforeEach(() => {
  jest.resetModules();
  savedEnvKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-anthropic-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  if (savedEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedEnvKey;
});

function writeSaved(values) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(values));
}

function sdk() {
  return require('@anthropic-ai/sdk').default;
}

describe('lib/anthropic client', () => {
  it('builds no client at import, then one from the saved key on first use', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });
    const { chatWithCo } = require('../../lib/anthropic');
    const Anthropic = sdk();
    expect(Anthropic).not.toHaveBeenCalled();

    const result = await chatWithCo('hello');

    expect(result.message).toBe('reply');
    expect(Anthropic).toHaveBeenCalledTimes(1);
    expect(Anthropic.mock.calls[0][0].apiKey).toBe(SAVED_KEY);
    expect(Anthropic.mock.instances[0].messages.create).toHaveBeenCalledTimes(1);
  });

  it('a key saved after import is used without a restart', async () => {
    const { chatWithCo } = require('../../lib/anthropic');
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });

    await chatWithCo('hello');

    const Anthropic = sdk();
    expect(Anthropic).toHaveBeenCalledTimes(1);
    expect(Anthropic.mock.calls[0][0].apiKey).toBe(SAVED_KEY);
  });

  it('keeps the same client while the key is unchanged', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });
    const { chatWithCo } = require('../../lib/anthropic');

    await chatWithCo('one');
    await chatWithCo('two');

    const Anthropic = sdk();
    expect(Anthropic).toHaveBeenCalledTimes(1);
    expect(Anthropic.mock.instances[0].messages.create).toHaveBeenCalledTimes(2);
  });

  it('builds a new client when the saved key changes, and uses it', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });
    const { chatWithCo } = require('../../lib/anthropic');
    await chatWithCo('one');

    writeSaved({ ANTHROPIC_API_KEY: OTHER_SAVED_KEY });
    await chatWithCo('two');

    const Anthropic = sdk();
    expect(Anthropic).toHaveBeenCalledTimes(2);
    expect(Anthropic.mock.calls[1][0].apiKey).toBe(OTHER_SAVED_KEY);
    expect(Anthropic.mock.instances[0].messages.create).toHaveBeenCalledTimes(1);
    expect(Anthropic.mock.instances[1].messages.create).toHaveBeenCalledTimes(1);
  });

  it('the default export calls through to the client for the current key', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });
    const anthropic = require('../../lib/anthropic').default;

    await anthropic.messages.create({ model: 'm', max_tokens: 1, messages: [] });

    const Anthropic = sdk();
    expect(Anthropic).toHaveBeenCalledTimes(1);
    expect(Anthropic.mock.calls[0][0].apiKey).toBe(SAVED_KEY);
    expect(Anthropic.mock.instances[0].messages.create).toHaveBeenCalledTimes(1);
  });

  it('an env key wins over a saved key', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });
    process.env.ANTHROPIC_API_KEY = ENV_KEY;
    const { chatWithCo } = require('../../lib/anthropic');

    await chatWithCo('hello');

    const Anthropic = sdk();
    expect(Anthropic).toHaveBeenCalledTimes(1);
    expect(Anthropic.mock.calls[0][0].apiKey).toBe(ENV_KEY);
  });
});

describe('GET /api/health and the saved Anthropic key', () => {
  async function health() {
    const handler = require('../../pages/api/health').default;
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);
    return res._getData();
  }

  it('reports Anthropic as configured when only a saved key exists', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });
    const raw = await health();
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    expect(body.checks.anthropic_env).toBe(true);
  });

  it('reports Anthropic as not configured when there is no key anywhere', async () => {
    const raw = await health();
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    expect(body.checks.anthropic_env).toBe(false);
  });

  it('never includes the saved key or its mask', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });
    const raw = await health();
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    expect(text).not.toContain(SAVED_KEY);
    expect(text).not.toContain('QWXZ');
  });
});
