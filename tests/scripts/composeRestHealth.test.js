// End-to-end run (co-sign-449): the `rest` service (PostgREST v13) was never
// healthy. Its healthcheck ran `postgrest --ready`, which that version answers
// with "Invalid option", and the image has no shell, wget or curl to ask its
// admin port with. The healthcheck must not use any of those; when it runs no
// check at all, a comment in the service says why.

const fs = require('fs');
const path = require('path');

const compose = fs.readFileSync(path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8');

function serviceBlock(name) {
  const lines = compose.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return [];
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end]) && !/^\S/.test(lines[end])) end += 1;
  return lines.slice(start, end);
}

// The healthcheck's lines (without comments), [] when there is none.
function healthcheck(lines) {
  const start = lines.findIndex((l) => l === '    healthcheck:');
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*#/.test(lines[i])) continue;
    if (lines[i].trim() !== '' && !/^ {6}/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

describe('rest healthcheck', () => {
  const rest = serviceBlock('rest');
  const check = healthcheck(rest);
  const testLine = check.find((l) => /^\s+test:/.test(l)) || '';
  const disabled = check.some((l) => l.trim() === 'disable: true');

  it('the rest service is in the file', () => {
    expect(rest.length).toBeGreaterThan(0);
  });

  it('never runs postgrest --ready, which PostgREST v13 rejects', () => {
    expect(rest.filter((l) => !/^\s*#/.test(l)).join('\n')).not.toContain('--ready');
  });

  it('never needs wget, curl or a shell, which the image does not have', () => {
    expect(testLine).not.toMatch(/\b(wget|curl|sh|bash|CMD-SHELL)\b/);
  });

  it('either runs a check or says in a comment why it has none', () => {
    if (testLine && !disabled) return;
    expect(rest.some((l) => /^\s*#\s*\S/.test(l))).toBe(true);
  });
});
