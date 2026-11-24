// End-to-end run (co-sign-418): the first `docker compose up` in CI stopped
// with "container co-sign-storage-1 is unhealthy" although storage logged
// "Server listening at http://0.0.0.0:5000" two seconds after it started.
// storage-api listens on IPv4 only; its healthcheck asked localhost, which
// wget in the image may try as ::1 first. The check asks 127.0.0.1.

const fs = require('fs');
const path = require('path');

const compose = fs.readFileSync(path.join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8');

function serviceBlock(name) {
  const lines = compose.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return '';
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end]) && !/^\S/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

describe('storage healthcheck', () => {
  const storage = serviceBlock('storage');

  it('asks storage on 127.0.0.1, where it listens', () => {
    expect(storage).toContain('"http://127.0.0.1:5000/status"');
  });

  it('never asks localhost', () => {
    const check = /healthcheck:\n\s+test: (.*)/.exec(storage);
    expect(check).not.toBeNull();
    expect(check[1]).not.toContain('localhost');
  });
});
