// co-sign-425: the hosted database has fill_sessions.verification_attempts
// (verify.js counts failed codes in it) and increment_completion_count(uuid)
// (complete.js calls it), but no migration made either, so a database built
// from the migrations lacked both. These tests pin the migration that adds them.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = '20261119100000_add_hosted_only_objects.sql';
const SIGNATURE = 'public.increment_completion_count(uuid)';

function read(...parts) {
  const file = path.join(ROOT, ...parts);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');
const squash = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

const sql = stripComments(read('supabase', 'migrations', MIGRATION));

// Statements outside dollar-quoted bodies, split on ';'.
function statements() {
  return sql.replace(/\$\$[\s\S]*?\$\$/g, 'BODY').split(';').map(squash).filter(Boolean);
}

function functionBody() {
  const at = sql.search(/create\s+or\s+replace\s+function\s+public\.increment_completion_count\s*\(/i);
  if (at < 0) return '';
  const match = /\$\$([\s\S]*?)\$\$/.exec(sql.slice(at));
  return match ? squash(match[1]) : '';
}

const escapeName = (name) => name.replace(/[.()]/g, '\\$&').replace(/\s+/g, '\\s*');

describe(`migration ${MIGRATION}`, () => {
  it('adds fill_sessions.verification_attempts as integer not null default 0, if not there yet', () => {
    expect(sql).toMatch(
      /alter\s+table\s+(if\s+exists\s+)?public\.fill_sessions\s+add\s+column\s+if\s+not\s+exists\s+verification_attempts\s+integer\s+not\s+null\s+default\s+0\s*;/i
    );
  });

  it('creates or replaces increment_completion_count(doc_id uuid)', () => {
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.increment_completion_count\s*\(\s*doc_id\s+uuid\s*\)\s+returns\s+void/i);
  });

  it('gives the function the body SUPABASE-SETUP.sql has', () => {
    // Hand-copied from SUPABASE-SETUP.sql.
    expect(functionBody()).toBe(
      'begin update public.documents set completion_count = coalesce(completion_count, 0) + 1 where id = doc_id; end;'
    );
  });

  it('pins search_path to public', () => {
    const at = sql.search(/create\s+or\s+replace\s+function\s+public\.increment_completion_count/i);
    expect(at).toBeGreaterThan(-1);
    expect(sql.slice(at)).toMatch(/\bset\s+search_path\s*=\s*public\b/i);
  });

  it('lets only service_role execute it', () => {
    const name = escapeName(SIGNATURE);
    const grants = [...sql.matchAll(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${name}\\s+to\\s+([^;]+);`, 'gi'))]
      .map((m) => m[1].trim().toLowerCase());
    expect(grants).toEqual(['service_role']);
    const revoke = new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${name}\\s+from\\s+([^;]+);`, 'i').exec(sql);
    const revoked = revoke ? revoke[1].split(',').map((r) => r.trim().toLowerCase()) : [];
    expect(revoked).toEqual(expect.arrayContaining(['public', 'anon', 'authenticated']));
  });

  it('has only statements that can run twice', () => {
    const list = statements();
    expect(list.length).toBeGreaterThan(0);
    const rerunnable = [
      /^begin$/,
      /^commit$/,
      /^alter table (if exists )?public\.fill_sessions add column if not exists /,
      /^create or replace function /,
      /^revoke /,
      /^grant /,
    ];
    for (const statement of list) {
      expect([statement, rerunnable.some((re) => re.test(statement))]).toEqual([statement, true]);
    }
  });
});

describe('schema check EXPECTED', () => {
  it('lists fill_sessions.verification_attempts and increment_completion_count', () => {
    const { EXPECTED } = require('../../scripts/db/schemaCheck');
    expect(EXPECTED.tables.fill_sessions).toContain('verification_attempts');
    expect(EXPECTED.rpcs).toContain('increment_completion_count');
  });
});
