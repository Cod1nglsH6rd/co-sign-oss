/**
 * scanSourceUsage(text): the tables, database functions and storage buckets a
 * piece of JS source calls, and a walk over the app source that checks every
 * one of them is listed in EXPECTED.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCANNED_DIRS = ['pages', 'lib', 'hooks', 'components'];
const SOURCE_FILE = /\.(js|jsx|ts|tsx)$/;

function load() {
  const mod = require('../../scripts/db/schemaCheck.js');
  expect(typeof mod.scanSourceUsage).toBe('function');
  return mod;
}

function sourceFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

describe('scanSourceUsage', () => {
  it('finds a table in a single-line .from call', () => {
    const { scanSourceUsage } = load();
    const result = scanSourceUsage(
      "const { data } = await supabase.from('fields').select('id').eq('id', 1);"
    );
    expect(result).toEqual({ tables: ['fields'], rpcs: [], buckets: [] });
  });

  it('puts a storage .from split across lines in buckets, not tables', () => {
    const { scanSourceUsage } = load();
    const result = scanSourceUsage(
      "const { data } = await supabase.storage\n  .from('documents')\n  .download(path);"
    );
    expect(result).toEqual({ tables: [], rpcs: [], buckets: ['documents'] });
  });

  it('finds a table .from split across lines', () => {
    const { scanSourceUsage } = load();
    const result = scanSourceUsage(
      "const { data } = await supabase\n    .from('fill_sessions')\n    .select('id');"
    );
    expect(result).toEqual({ tables: ['fill_sessions'], rpcs: [], buckets: [] });
  });

  it('finds an rpc call', () => {
    const { scanSourceUsage } = load();
    const result = scanSourceUsage(
      "await supabase.rpc('increment_completion_count', { doc_id: id });"
    );
    expect(result).toEqual({
      tables: [],
      rpcs: ['increment_completion_count'],
      buckets: [],
    });
  });

  it('accepts double-quoted names', () => {
    const { scanSourceUsage } = load();
    const result = scanSourceUsage(
      'supabase.from("audit_log").insert(row);\n' +
        'supabase.rpc("enterprise_finalize_setup_tx", args);\n' +
        'supabase.storage.from("filled-documents").upload(p, b);'
    );
    expect(result).toEqual({
      tables: ['audit_log'],
      rpcs: ['enterprise_finalize_setup_tx'],
      buckets: ['filled-documents'],
    });
  });

  it('lists each name once and keeps the same name apart as table and bucket', () => {
    const { scanSourceUsage } = load();
    const result = scanSourceUsage(
      "supabase.from('documents').select('*');\n" +
        "supabase.from('documents').update(x);\n" +
        "supabase.storage.from('documents').remove([p]);"
    );
    expect(result).toEqual({ tables: ['documents'], rpcs: [], buckets: ['documents'] });
  });

  it('ignores .from calls whose argument is not a string literal', () => {
    const { scanSourceUsage } = load();
    const result = scanSourceUsage(
      'const ids = Array.from(selected);\n' +
        'await supabase.storage\n  .from(bucket)\n  .download(p);'
    );
    expect(result).toEqual({ tables: [], rpcs: [], buckets: [] });
  });

  it('returns empty lists for text with no calls', () => {
    const { scanSourceUsage } = load();
    expect(scanSourceUsage('')).toEqual({ tables: [], rpcs: [], buckets: [] });
  });
});

describe('app source against EXPECTED', () => {
  function scanApp() {
    const { scanSourceUsage, EXPECTED } = load();
    const missing = [];
    const seen = { tables: 0, rpcs: 0, buckets: 0 };
    const known = {
      tables: Object.keys(EXPECTED.tables),
      rpcs: EXPECTED.rpcs,
      buckets: EXPECTED.buckets,
    };
    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const usage = scanSourceUsage(fs.readFileSync(file, 'utf8'));
        const rel = path.relative(ROOT, file);
        for (const kind of ['tables', 'rpcs', 'buckets']) {
          seen[kind] += usage[kind].length;
          for (const name of usage[kind]) {
            if (!known[kind].includes(name)) {
              missing.push(`${rel}: ${kind} '${name}' is not in EXPECTED.${kind}`);
            }
          }
        }
      }
    }
    return { missing, seen };
  }

  it('finds tables, rpcs and buckets in pages/, lib/, hooks/ and components/', () => {
    const { seen } = scanApp();
    expect(seen.tables).toBeGreaterThan(0);
    expect(seen.rpcs).toBeGreaterThan(0);
    expect(seen.buckets).toBeGreaterThan(0);
  });

  it('names every table, rpc and bucket the app calls in EXPECTED', () => {
    const { missing } = scanApp();
    if (missing.length) {
      throw new Error(`Not in EXPECTED:\n${missing.join('\n')}`);
    }
    expect(missing).toEqual([]);
  });
});
