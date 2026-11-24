// co-sign-426: SUPABASE-SETUP.sql made "Service role can manage filled
// documents" FOR ALL with no TO role and USING (bucket_id = 'filled-documents'),
// so anyone (anon included) could read, write and delete filled PDFs. The
// service role bypasses RLS and never needed it. These tests pin the migration
// that drops it, keeps both buckets private, and guard later migrations from
// bringing the same shape back.

const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const LOCKDOWN = '20261119100100_storage_policies_lockdown.sql';

function readMigration(name) {
  const file = path.join(MIGRATIONS, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function statements(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

// The text inside the parentheses that follow `keyword`, or null.
function clause(stmt, keyword) {
  const match = new RegExp(`\\b${keyword}\\s*\\(`, 'i').exec(stmt);
  if (!match) return null;
  let depth = 1;
  const start = match.index + match[0].length;
  for (let i = start; i < stmt.length; i += 1) {
    if (stmt[i] === '(') depth += 1;
    if (stmt[i] === ')') depth -= 1;
    if (depth === 0) return stmt.slice(start, i);
  }
  return null;
}

// Names of storage.objects policies with no TO role whose USING or WITH CHECK
// is nothing but a bucket_id comparison.
function openBucketOnlyPolicies(sql) {
  const found = [];
  for (const stmt of statements(sql)) {
    const head = /^create\s+policy\s+("[^"]+"|\S+)\s+on\s+storage\.objects\b/i.exec(stmt);
    if (!head) continue;
    const beforeClauses = stmt.slice(head[0].length).split(/\b(?:using|with\s+check)\s*\(/i)[0];
    const hasRole = /\bto\s+\w+/i.test(beforeClauses);
    const bucketOnly = [clause(stmt, 'using'), clause(stmt, 'with\\s+check')]
      .filter((c) => c !== null)
      .some((c) => /^[\s(]*bucket_id\s*=\s*'[^']*'[\s)]*$/i.test(c));
    if (!hasRole && bucketOnly) found.push(head[1]);
  }
  return found;
}

// For each insert into storage.buckets: { id, public, upsertsPublicFalse }.
function bucketInserts(sql) {
  const rows = [];
  for (const stmt of statements(sql)) {
    const head = /^insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values/i.exec(stmt);
    if (!head) continue;
    const columns = head[1].split(',').map((c) => c.trim().toLowerCase());
    const [values, conflict = ''] = stmt.slice(head[0].length).split(/\bon\s+conflict\b/i);
    const upsertsPublicFalse = /^\s*\(\s*id\s*\)\s*do\s+update\s+set\b[\s\S]*\bpublic\s*=\s*(?:false|excluded\.public)\b/i.test(conflict);
    const tuples = values.match(/\((?:[^()]|\[[^\]]*\]|\([^()]*\))*\)/g) || [];
    for (const tuple of tuples) {
      const cells = tuple.slice(1, -1).split(/,(?![^[]*\])/).map((c) => c.trim());
      rows.push({
        id: cells[columns.indexOf('id')],
        public: (cells[columns.indexOf('public')] || '').toLowerCase(),
        upsertsPublicFalse,
      });
    }
  }
  return rows;
}

describe('the open-bucket detector', () => {
  it('flags the original policy: FOR ALL, no TO role, USING only bucket_id', () => {
    const sql = `create policy "Service role can manage filled documents"
      on storage.objects for all
      using (bucket_id = 'filled-documents');`;
    expect(openBucketOnlyPolicies(sql)).toEqual(['"Service role can manage filled documents"']);
  });

  it('flags a WITH CHECK that is only a bucket_id comparison', () => {
    const sql = `CREATE POLICY anyone_upload ON storage.objects FOR INSERT
      WITH CHECK ((bucket_id = 'documents'));`;
    expect(openBucketOnlyPolicies(sql)).toEqual(['anyone_upload']);
  });

  it('does not flag a policy with a TO role or with more than a bucket_id check', () => {
    const sql = `create policy "a" on storage.objects for all to service_role
        using (bucket_id = 'filled-documents');
      create policy "b" on storage.objects for select
        using (bucket_id = 'documents' and auth.uid() is not null);`;
    expect(openBucketOnlyPolicies(sql)).toEqual([]);
  });
});

describe(`migration ${LOCKDOWN}`, () => {
  const sql = readMigration(LOCKDOWN);

  it('drops "Service role can manage filled documents" on storage.objects if it exists', () => {
    const drops = statements(sql).filter((s) =>
      /^drop\s+policy\s+if\s+exists\s+"Service role can manage filled documents"\s+on\s+storage\.objects$/i.test(s));
    expect(drops).toHaveLength(1);
  });

  it.each(['documents', 'filled-documents'])('makes sure the %s bucket exists and is private', (bucket) => {
    const rows = bucketInserts(sql).filter((r) => r.id === `'${bucket}'`);
    expect(rows).toEqual([{ id: `'${bucket}'`, public: 'false', upsertsPublicFalse: true }]);
  });
});

describe('storage.objects policies from this migration on', () => {
  it('none is open to any role with only a bucket_id check', () => {
    const names = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    expect(names).toContain(LOCKDOWN);
    const open = names
      .filter((name) => name >= LOCKDOWN)
      .flatMap((name) => openBucketOnlyPolicies(readMigration(name)).map((p) => `${name}: ${p}`));
    expect(open).toEqual([]);
  });
});
