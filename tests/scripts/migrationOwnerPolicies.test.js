// The owner policies on documents and fill_sessions checked only that a row
// named the user, never which organisation it landed in: any signed-in user
// could file a document under another organisation, move their own document
// there, or create (or repoint) a fill session on another organisation's
// document. The access check found it (authenticated:insert:public.documents,
// authenticated:insert:public.fill_sessions and the two move cases). These
// tests pin the migration that closes it and guard later migrations from
// opening it again.

const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FIX = '20261121100000_owner_policies_stay_in_own_org.sql';

function readMigration(name) {
  const file = path.join(MIGRATIONS, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function statements(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
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

// { name, table, check } for every ALTER or CREATE POLICY with a WITH CHECK.
function checks(sql) {
  const found = [];
  for (const stmt of statements(sql)) {
    const head = /^(?:alter|create) policy "([^"]+)" on (\S+)/i.exec(stmt);
    if (!head) continue;
    const check = clause(stmt, 'with check');
    if (check !== null) found.push({ name: head[1], table: head[2], check });
  }
  return found;
}

const ACTIVE_MEMBER = /from public\.org_memberships m where m\.org_id = (documents|d)\.org_id and m\.user_id = \(select auth\.uid\(\)\) and m\.status = 'active'/i;

describe(`migration ${FIX}`, () => {
  const sql = readMigration(FIX);
  const byName = Object.fromEntries(checks(sql).map((c) => [c.name, c]));

  it('comes after every migration it builds on and edits no other policy', () => {
    const names = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    expect(names).toContain(FIX);
    expect(FIX > '20261119100300_remove_billing_schema.sql').toBe(true);
    expect(Object.keys(byName).sort()).toEqual(
      [
        'Owner can insert documents',
        'Owner can update documents',
        'Clients can create sessions',
        'Clients can update own sessions',
      ].sort()
    );
    // Nothing is dropped, created or opened; only these four checks change.
    expect(statements(sql).every((s) => /^alter policy /i.test(s))).toBe(true);
  });

  it.each(['Owner can insert documents', 'Owner can update documents'])(
    '"%s" keeps the owner test and adds: no org, or an org the user is an active member of',
    (name) => {
      const { table, check } = byName[name];
      expect(table).toBe('public.documents');
      expect(check).toContain('(user_id = ((select auth.uid()))::text) OR (created_by = (select auth.uid()))');
      expect(check).toMatch(/\) AND \( org_id IS NULL OR EXISTS \(/i);
      expect(check).toMatch(ACTIVE_MEMBER);
    }
  );

  it.each(['Clients can create sessions', 'Clients can update own sessions'])(
    '"%s" keeps the client test and adds: a document the user owns or whose org they are an active member of',
    (name) => {
      const { table, check } = byName[name];
      expect(table).toBe('public.fill_sessions');
      expect(check).toMatch(/^\s*\(\(select auth\.uid\(\)\) = client_user_id\) AND EXISTS \(/i);
      expect(check).toContain('d.id = fill_sessions.document_id');
      expect(check).toContain('d.user_id = ((select auth.uid()))::text');
      expect(check).toContain('d.created_by = (select auth.uid())');
      expect(check).toMatch(ACTIVE_MEMBER);
    }
  );
});

describe('the owner and client write policies from this migration on', () => {
  // A later migration that sets one of these four checks again must keep the
  // organisation test.
  it('never set a check without the organisation test again', () => {
    const names = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    const reopened = names
      .filter((name) => name >= FIX)
      .flatMap((name) =>
        checks(readMigration(name))
          .filter((c) => /^(Owner can (insert|update) documents|Clients can (create|update own) sessions)$/.test(c.name))
          .filter((c) => !ACTIVE_MEMBER.test(c.check))
          .map((c) => `${name}: ${c.name}`)
      );
    expect(reopened).toEqual([]);
  });
});
