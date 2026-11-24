/**
 * One Supabase cloud path that works (release review T1b). The README's
 * database step used to have a cloud reader run only SUPABASE-SETUP.sql in
 * the SQL editor, which misses every migration (app_config, the storage
 * lockdown), and pointed at an obsolete schema printed by scripts/setup.sh.
 * Now the step builds a new, empty project with `npm run db:migrate`
 * (the baseline and every migration, in order), the testing section's
 * "never" is about a hosted database that already holds data, and setup.sh
 * only installs dependencies and copies .env.example.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Collapse line breaks and runs of spaces so wrapping does not matter.
function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Getting Started's numbered step 4, up to step 5.
function databaseStep() {
  const readme = read('README.md');
  const quick = readme.indexOf('#### Quick Start');
  expect(quick).toBeGreaterThan(-1);
  const start = readme.indexOf('\n4. **', quick);
  expect(start).toBeGreaterThan(-1);
  const end = readme.indexOf('\n5. **', start);
  expect(end).toBeGreaterThan(start);
  return flat(readme.slice(start, end));
}

function testingSection() {
  const readme = read('README.md');
  const start = readme.indexOf('### Testing');
  expect(start).toBeGreaterThan(-1);
  const next = readme.indexOf('\n### ', start + 1);
  return flat(readme.slice(start, next === -1 ? undefined : next));
}

describe('README: the Supabase cloud database step', () => {
  test('builds a new, empty project with npm run db:migrate', () => {
    const step = databaseStep();
    expect(step).toContain('MIGRATE_ALLOW_REMOTE=1 DATABASE_URL=');
    expect(step).toContain('npm run db:migrate');
    expect(step).toMatch(/new, empty Supabase project/i);
  });

  test('says it applies the baseline and every migration, in order', () => {
    const step = databaseStep();
    expect(step).toContain('SUPABASE-SETUP.sql');
    expect(step).toContain('supabase/migrations/');
    expect(step).toMatch(/every (file|migration)/i);
    expect(step).toMatch(/in (name )?order/i);
  });

  test('says the never is for a database that already holds data', () => {
    expect(databaseStep()).toMatch(/never[^.]*database that already holds data/i);
    expect(testingSection()).toMatch(/never[^.]*hosted database that already holds data/i);
  });

  test('no longer has the SQL-editor-only step or the schema printed by setup.sh', () => {
    const readme = read('README.md');
    expect(readme).not.toContain('extended schema printed by');
    expect(readme).not.toMatch(/Run the contents of `SUPABASE-SETUP\.sql` in the Supabase SQL editor/);
  });

  test('says where to copy the connection string from, and writes none out', () => {
    const step = databaseStep();
    expect(step).toMatch(/connection string/i);
    expect(step).toMatch(/Connect/);
    // scheme://user[:password]@host: the secret scan refuses any of these.
    expect(read('README.md')).not.toMatch(/postgres(?:ql)?:\/\/[^\s`'"/@]+@/);
  });
});

describe('scripts/setup.sh only installs and copies the env template', () => {
  const script = () => read('scripts/setup.sh');

  test('prints no SQL', () => {
    expect(script()).not.toMatch(/create table/i);
    expect(script()).not.toMatch(/create extension|create policy|create function/i);
  });

  test('names no OAuth, Document AI, OpenAI or billing step', () => {
    expect(script()).not.toMatch(/oauth|document ai|openai|billing|stripe|google/i);
  });

  test('installs dependencies and copies .env.example to .env.local when missing', () => {
    const text = script();
    expect(text).toContain('npm install');
    expect(text).toMatch(/if \[ ! -f \.env\.local \]/);
    expect(text).toContain('cp .env.example .env.local');
  });
});
