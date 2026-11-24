// End-to-end run (co-sign-418): on a fresh database `migrate` stopped at
// 20260417000100 ("column f.explanation_vi does not exist"). The migrations
// were written against the hosted database, which has columns and a table
// SUPABASE-SETUP.sql (the baseline scripts/db/migrate.js runs first) did not
// make. Checked by running the baseline and every migration on PGlite with
// stand-ins for the Supabase auth and storage schemas; these tests pin what
// that needed.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const baseline = fs.readFileSync(path.join(ROOT, 'SUPABASE-SETUP.sql'), 'utf8');
const migration = (name) => fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', name), 'utf8');

function createTable(name) {
  const match = new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`).exec(baseline);
  return match ? match[1] : null;
}

describe('the baseline has what the migrations expect of the hosted database', () => {
  it('documents.user_id is text, since the RLS migrations compare it with auth.uid()::text', () => {
    expect(createTable('documents')).toMatch(/\n\s+user_id text,/);
    expect(migration('20260612120000_tighten_rls_documents_fields_chat.sql')).toContain('d.user_id = auth.uid()::text');
  });

  it('fields has the Vietnamese and Spanish columns 20260417000100 reads', () => {
    const fields = createTable('fields');
    for (const column of ['field_name_vi', 'field_name_es', 'explanation_vi', 'explanation_es']) {
      expect([column, new RegExp(`\\n\\s+${column} text,`).test(fields)]).toEqual([column, true]);
    }
  });

  it('fill_sessions has updated_at, which its update trigger sets (no update of a link worked without it)', () => {
    expect(migration('20260313000000_create_fill_sessions.sql')).toMatch(/CREATE TRIGGER fill_sessions_updated_at\s+BEFORE UPDATE ON public\.fill_sessions/);
    expect(createTable('fill_sessions')).toMatch(/\n\s+updated_at timestamp with time zone default now\(\)/);
  });

  it('chat_history exists, with RLS on, before the migrations set its policies', () => {
    const chat = createTable('chat_history');
    expect(chat).not.toBeNull();
    for (const column of ['user_id text', 'document_id uuid', 'message text', 'response text', 'timestamp timestamp with time zone']) {
      expect(chat).toContain(column);
    }
    expect(baseline).toContain('alter table public.chat_history enable row level security;');
  });
});

describe('20260417000100 can follow 20260322000100', () => {
  it('drops enterprise_duplicate_template_tx before making it with parameters in another order', () => {
    const sql = migration('20260417000100_cleanup_legacy_translation_columns.sql');
    const drop = sql.indexOf('DROP FUNCTION IF EXISTS public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text);');
    const create = sql.indexOf('CREATE OR REPLACE FUNCTION public.enterprise_duplicate_template_tx(');
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
  });
});
