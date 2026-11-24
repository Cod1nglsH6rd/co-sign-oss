/**
 * EXPECTED: the tables, columns, functions and buckets the app uses, and
 * which tables hold user data versus service-only data.
 */

function load() {
  return require('../../scripts/db/schemaCheck.js');
}

const NAMED_TABLES = [
  'documents',
  'fields',
  'fill_sessions',
  'session_fields',
  'org_memberships',
  'organizations',
  'audit_log',
  'chat_history',
  'beta_signups',
  'app_config',
];

// Languages with translation columns on `fields` (pages/api/ocr.js, all but en).
const TRANSLATION_LANGUAGES = ['vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne'];

describe('EXPECTED', () => {
  it('lists every table the ticket names', () => {
    const { EXPECTED } = load();
    expect(EXPECTED).toBeDefined();
    for (const name of NAMED_TABLES) {
      expect(Object.keys(EXPECTED.tables)).toContain(name);
    }
  });

  it('gives every table a non-empty list of column names', () => {
    const { EXPECTED } = load();
    const names = Object.keys(EXPECTED.tables);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const columns = EXPECTED.tables[name];
      expect(Array.isArray(columns)).toBe(true);
      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) {
        expect(typeof column).toBe('string');
        expect(column).not.toBe('');
      }
    }
  });

  it('lists the documents columns written when a scan is saved', () => {
    const { EXPECTED } = load();
    expect(EXPECTED.tables.documents).toEqual(
      expect.arrayContaining(['has_rect', 'is_multi_party'])
    );
  });

  it('lists every per-language translation column on fields', () => {
    const { EXPECTED } = load();
    for (const lang of TRANSLATION_LANGUAGES) {
      for (const base of ['field_name', 'explanation', 'position_hint']) {
        expect(EXPECTED.tables.fields).toContain(`${base}_${lang}`);
      }
    }
  });

  it('names every userData and serviceOnly table in EXPECTED.tables', () => {
    const { EXPECTED } = load();
    expect(EXPECTED.userData.length).toBeGreaterThan(0);
    for (const name of [...EXPECTED.userData, ...EXPECTED.serviceOnly]) {
      expect(Object.keys(EXPECTED.tables)).toContain(name);
    }
  });

  it('puts no table in both userData and serviceOnly', () => {
    const { EXPECTED } = load();
    const both = EXPECTED.userData.filter((n) => EXPECTED.serviceOnly.includes(n));
    expect(both).toEqual([]);
  });

  it('marks beta_signups and app_config as service-only', () => {
    const { EXPECTED } = load();
    expect([...EXPECTED.serviceOnly].sort()).toEqual(['app_config', 'beta_signups']);
  });

  it('lists exactly the three database functions the app calls', () => {
    const { EXPECTED } = load();
    expect([...EXPECTED.rpcs].sort()).toEqual([
      'enterprise_duplicate_template_tx',
      'enterprise_finalize_setup_tx',
      'increment_completion_count',
    ]);
  });

  it('lists exactly the two storage buckets the app uses', () => {
    const { EXPECTED } = load();
    expect([...EXPECTED.buckets].sort()).toEqual(['documents', 'filled-documents']);
  });
});
