/**
 * Issue co-sign-359: in the Docker stack sign-up is off unless the person
 * running it sets COSIGN_ALLOW_SIGNUP=true. GoTrue confirms new accounts at
 * once there (no SMTP), so open sign-up would let anyone who can reach the
 * port make a confirmed account and use the owner's AI key.
 *
 * These tests read docker-compose.yml as text; Docker is never started.
 *
 * The first admin does not need open sign-up: POST /api/setup/admin creates
 * it with the service key's supabase.auth.admin.createUser call (with
 * email_confirm: true), which GOTRUE_DISABLE_SIGNUP does not block. That is
 * already tested in tests/lib/firstAdmin.test.js (createFirstAdmin calls
 * supabase.auth.admin.createUser) and tests/api/setupAdmin.test.js (a good
 * setup code and body answer 201).
 */

const fs = require('fs');
const path = require('path');

const COMPOSE = path.join(__dirname, '..', '..', 'docker-compose.yml');

// A missing file reads as '' so each test fails on its assertion.
function read() {
  return fs.existsSync(COMPOSE) ? fs.readFileSync(COMPOSE, 'utf8') : '';
}

function isComment(line) {
  return /^\s*#/.test(line);
}

// The lines of the auth service, from `  auth:` up to the next service.
function authLines() {
  const lines = read().split('\n');
  const start = lines.findIndex((l) => l === '  auth:');
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {0,2}\S/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

// The shell the auth container runs: the last item of its entrypoint list.
function authEntrypoint() {
  const lines = authLines();
  const start = lines.findIndex((l) => l.trim() === 'entrypoint:');
  if (start === -1) return '';
  const items = [];
  for (let i = start + 1; i < lines.length && /^\s*- /.test(lines[i]); i += 1) {
    items.push(lines[i].replace(/^\s*- /, ''));
  }
  return items[items.length - 1] || '';
}

describe('docker-compose.yml sign-up (co-sign-359)', () => {
  it('passes COSIGN_ALLOW_SIGNUP to auth with false as its default', () => {
    const code = authLines().filter((l) => !isComment(l));
    expect(code.map((l) => l.trim())).toContain('COSIGN_ALLOW_SIGNUP: ${COSIGN_ALLOW_SIGNUP:-false}');
  });

  it('never sets COSIGN_ALLOW_SIGNUP to anything but its own variable with default false', () => {
    const uses = read()
      .split('\n')
      .filter((l) => !isComment(l))
      .join('\n')
      .match(/\$\{COSIGN_ALLOW_SIGNUP[^}]*\}/g);
    expect(uses).toEqual(['${COSIGN_ALLOW_SIGNUP:-false}']);
  });

  it('has no fixed GOTRUE_DISABLE_SIGNUP in the environment', () => {
    const fixed = authLines().filter((l) => !isComment(l) && /^\s*GOTRUE_DISABLE_SIGNUP\s*:/.test(l));
    expect(fixed).toEqual([]);
  });

  it('disables sign-up unless COSIGN_ALLOW_SIGNUP is exactly true', () => {
    const sh = authEntrypoint();
    const branch = sh.match(
      /if \[ "\$\$COSIGN_ALLOW_SIGNUP" = "?true"? \]; then export GOTRUE_DISABLE_SIGNUP=(\w+); else export GOTRUE_DISABLE_SIGNUP=(\w+); fi/
    );
    expect(branch).not.toBeNull();
    expect(branch.slice(1, 3)).toEqual(['false', 'true']);
    // The only place sign-up is turned on is that guarded branch.
    expect(sh.match(/GOTRUE_DISABLE_SIGNUP=false/g)).toHaveLength(1);
    // The choice is made before GoTrue starts.
    expect(sh.indexOf('; fi')).toBeLessThan(sh.indexOf('exec auth'));
  });

  it('warns above the setting what turning sign-up on means', () => {
    const lines = authLines();
    const at = lines.findIndex((l) => !isComment(l) && /^\s*COSIGN_ALLOW_SIGNUP\s*:/.test(l));
    expect(at).toBeGreaterThan(-1);
    const comment = [];
    for (let i = at - 1; i >= 0 && isComment(lines[i]); i -= 1) comment.unshift(lines[i]);
    const text = comment.join(' ').toLowerCase();
    expect(text).toMatch(/anyone/);
    expect(text).toMatch(/port/);
    expect(text).toMatch(/confirmed account/);
    expect(text).toMatch(/ai key/);
    expect(text).toMatch(/admin screen/);
  });
});
