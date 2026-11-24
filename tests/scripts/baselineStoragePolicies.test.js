// SUPABASE-SETUP.sql is the whole schema for a Supabase cloud install (the
// README has it run in the SQL editor on its own). It used to create "Service
// role can manage filled documents": FOR ALL, no TO role, USING only
// bucket_id = 'filled-documents', so every role, anon included, could list,
// read, overwrite and delete filled PDFs. The service role bypasses row-level
// security and never needed it. Migration 20261119100100 drops it on databases
// that ran the old baseline; these tests keep it out of the baseline itself.

const fs = require('fs');
const path = require('path');

const baseline = fs.readFileSync(path.join(__dirname, '..', '..', 'SUPABASE-SETUP.sql'), 'utf8');

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

// Every `create policy ... on storage.objects` in the baseline, with its role
// list and its USING / WITH CHECK conditions.
function storagePolicies(sql) {
  return statements(sql)
    .map((stmt) => {
      const head = /^create\s+policy\s+("[^"]+"|\S+)\s+on\s+storage\.objects\b/i.exec(stmt);
      if (!head) return null;
      const beforeClauses = stmt.slice(head[0].length).split(/\b(?:using|with\s+check)\s*\(/i)[0];
      const role = /\bto\s+(\w+)/i.exec(beforeClauses);
      return {
        name: head[1],
        role: role ? role[1].toLowerCase() : null,
        conditions: [clause(stmt, 'using'), clause(stmt, 'with\\s+check')].filter((c) => c !== null),
      };
    })
    .filter(Boolean);
}

describe('storage.objects policies in SUPABASE-SETUP.sql', () => {
  const policies = storagePolicies(baseline);

  it('finds the policies (the parser still reads the file)', () => {
    expect(policies.length).toBeGreaterThan(0);
  });

  it('does not create "Service role can manage filled documents"', () => {
    expect(policies.map((p) => p.name)).not.toContain('"Service role can manage filled documents"');
    expect(baseline).not.toMatch(/Service role can manage filled documents/i);
  });

  it('gives every policy a TO role, and that role is authenticated', () => {
    expect(policies.filter((p) => p.role !== 'authenticated').map((p) => p.name)).toEqual([]);
  });

  it('ties every USING and WITH CHECK to auth.uid()', () => {
    const loose = policies.filter(
      (p) => p.conditions.length === 0 || p.conditions.some((c) => !/\bauth\.uid\(\)/i.test(c))
    );
    expect(loose.map((p) => p.name)).toEqual([]);
  });
});
