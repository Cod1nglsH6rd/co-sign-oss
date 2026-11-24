/**
 * lib/supabaseEnv.js reads the Supabase address and keys from process.env
 * when called, not when imported: SUPABASE_URL wins over
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_ANON_KEY over
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, and a blank value counts as not set.
 */

const NAMES = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

describe('lib/supabaseEnv', () => {
  let saved;

  beforeEach(() => {
    saved = {};
    for (const name of NAMES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  function load() {
    return require('../../lib/supabaseEnv.js');
  }

  it('prefers SUPABASE_URL, then NEXT_PUBLIC_SUPABASE_URL', () => {
    const { serverSupabaseUrl } = load();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://public.example.com';
    expect(serverSupabaseUrl()).toBe('https://public.example.com');
    process.env.SUPABASE_URL = 'https://server.example.com';
    expect(serverSupabaseUrl()).toBe('https://server.example.com');
  });

  it('prefers SUPABASE_ANON_KEY, then NEXT_PUBLIC_SUPABASE_ANON_KEY', () => {
    const { anonKey } = load();
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-anon';
    expect(anonKey()).toBe('public-anon');
    process.env.SUPABASE_ANON_KEY = 'server-anon';
    expect(anonKey()).toBe('server-anon');
  });

  it('reads the service key from SUPABASE_SERVICE_ROLE_KEY', () => {
    const { serviceKey } = load();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    expect(serviceKey()).toBe('service-key');
  });

  it('treats a blank value as not set and falls through to the next name', () => {
    const { serverSupabaseUrl, anonKey } = load();
    process.env.SUPABASE_URL = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://public.example.com';
    process.env.SUPABASE_ANON_KEY = '   ';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-anon';
    expect(serverSupabaseUrl()).toBe('https://public.example.com');
    expect(anonKey()).toBe('public-anon');
  });

  it('answers null when every name is blank or missing', () => {
    const { serverSupabaseUrl, anonKey, serviceKey } = load();
    process.env.SUPABASE_URL = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = ' ';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    expect(serverSupabaseUrl()).toBeNull();
    expect(anonKey()).toBeNull();
    expect(serviceKey()).toBeNull();
  });

  it('sees a value set after the module was imported', () => {
    const { serverSupabaseUrl, anonKey, serviceKey } = load();
    expect(serverSupabaseUrl()).toBeNull();
    process.env.SUPABASE_URL = 'https://late.example.com';
    process.env.SUPABASE_ANON_KEY = 'late-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'late-service';
    expect(serverSupabaseUrl()).toBe('https://late.example.com');
    expect(anonKey()).toBe('late-anon');
    expect(serviceKey()).toBe('late-service');
  });
});
