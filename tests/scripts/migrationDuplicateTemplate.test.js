// co-sign-427: the last rebuild of enterprise_duplicate_template_tx
// (20260617140000) filtered on documents.is_template and inserted storage_path,
// document_url and status 'draft'. None of those columns exist and 'draft' is
// not allowed by documents_status_check, so every template duplication failed.
// These tests pin the migration that rebuilds it on today's columns.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = '20261119100200_fix_duplicate_template_tx.sql';
const SIGNATURE = 'public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text)';

// Hand-copied from 20260322000100 (documents_status_check).
const ALLOWED_STATUSES = ['uploaded', 'processing', 'in_progress', 'ready', 'completed', 'error'];
// Hand-listed: every per-language column fields has after all migrations.
const LANGUAGES = ['vi', 'es', 'pt', 'zh', 'yue', 'ht', 'ne', 'fr'];
const LANGUAGE_COLUMNS = LANGUAGES.flatMap((lang) => [
  `field_name_${lang}`,
  `explanation_${lang}`,
  `position_hint_${lang}`,
]);

function read(...parts) {
  const file = path.join(ROOT, ...parts);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');

// Text inside the parentheses that open at or after `from`, or ''.
function parenBody(text, from) {
  const open = text.indexOf('(', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') depth -= 1;
    if (depth === 0) return text.slice(open + 1, i);
  }
  return '';
}

// Split on commas that are not inside parentheses.
function topLevelList(body) {
  const items = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function rpcKeys() {
  const src = read('pages', 'api', 'enterprise', 'templates', 'duplicate.js');
  const at = src.indexOf("rpc('enterprise_duplicate_template_tx'");
  const object = /\{([\s\S]*?)\}/.exec(src.slice(at))[1];
  return [...object.matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
}

const sql = stripComments(read('supabase', 'migrations', MIGRATION));

function functionParams() {
  const at = sql.search(/create\s+(or\s+replace\s+)?function\s+public\.enterprise_duplicate_template_tx\s*\(/i);
  if (at < 0) return [];
  return topLevelList(parenBody(sql, at)).map((p) => p.split(/\s+/)[0]);
}

function insertInto(table) {
  const at = sql.search(new RegExp(`insert\\s+into\\s+public\\.${table}\\s*\\(`, 'i'));
  if (at < 0) return { columns: [], rest: '' };
  const body = parenBody(sql, at);
  const columns = topLevelList(body).map((c) => c.toLowerCase());
  const rest = sql.slice(sql.indexOf(body, at) + body.length + 1);
  return { columns, rest };
}

describe(`migration ${MIGRATION}`, () => {
  it('reads the rpc call in duplicate.js (sanity check on the parser)', () => {
    expect(rpcKeys()).toEqual([
      'p_template_id', 'p_org_id', 'p_user_id', 'p_new_file_name', 'p_new_file_path', 'p_new_file_url',
    ]);
  });

  it('takes the parameters duplicate.js passes, in the same order', () => {
    expect(functionParams()).toEqual(rpcKeys());
  });

  it('drops the old function before creating the new one', () => {
    const drop = sql.search(/drop\s+function\s+if\s+exists\s+public\.enterprise_duplicate_template_tx\s*\(\s*uuid,\s*uuid,\s*uuid,\s*text,\s*text,\s*text\s*\)/i);
    const create = sql.search(/create\s+(or\s+replace\s+)?function\s+public\.enterprise_duplicate_template_tx\s*\(/i);
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
  });

  it.each(['is_template', 'storage_path', 'document_url', "'draft'"])('does not use %s', (name) => {
    expect(sql).toMatch(/enterprise_duplicate_template_tx/);
    expect(sql.toLowerCase()).not.toContain(name);
  });

  it('inserts file_path and file_url from the new-file parameters', () => {
    const { columns, rest } = insertInto('documents');
    const values = topLevelList(parenBody(rest, rest.search(/\bvalues\b/i)));
    expect(values[columns.indexOf('file_path')]).toBe('p_new_file_path');
    expect(values[columns.indexOf('file_url')]).toBe('p_new_file_url');
  });

  it('gives the copy a status documents_status_check allows', () => {
    const { columns, rest } = insertInto('documents');
    const values = topLevelList(parenBody(rest, rest.search(/\bvalues\b/i)));
    const status = (values[columns.indexOf('status')] || '').replace(/^'|'$/g, '');
    expect(ALLOWED_STATUSES).toContain(status);
  });

  it('copies every per-language column of fields', () => {
    const { columns, rest } = insertInto('fields');
    const selectList = /^\s*select\s+([\s\S]*?)\s+from\s+public\.fields\b/i.exec(rest);
    const selected = selectList ? topLevelList(selectList[1]).map((c) => c.toLowerCase()) : [];
    for (const column of LANGUAGE_COLUMNS) {
      const at = columns.indexOf(column);
      expect([column, at > -1 && selected[at] === `f.${column}`]).toEqual([column, true]);
    }
  });

  it('pins search_path to public', () => {
    expect(sql).toMatch(/\bset\s+search_path\s*=\s*public\b/i);
  });

  it('lets only service_role execute it', () => {
    const name = SIGNATURE.replace(/[.()]/g, '\\$&').replace(/\s+/g, '\\s*');
    const grants = [...sql.matchAll(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${name}\\s+to\\s+([^;]+);`, 'gi'))]
      .map((m) => m[1].trim().toLowerCase());
    expect(grants).toEqual(['service_role']);
    const revoke = new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+${name}\\s+from\\s+([^;]+);`, 'i').exec(sql);
    const revoked = revoke ? revoke[1].split(',').map((r) => r.trim().toLowerCase()) : [];
    expect(revoked).toEqual(expect.arrayContaining(['public', 'anon', 'authenticated']));
  });
});
