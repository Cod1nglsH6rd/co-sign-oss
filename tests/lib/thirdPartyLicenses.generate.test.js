/**
 * Licence-list generator: collect(lockJson) reads a package-lock.json object
 * into one entry per package, render(entries, reviewed) writes Markdown with
 * runtime and dev sections grouped by licence and a Flagged section for
 * licences that may not fit MIT, and check(entries, reviewed) is what
 * `--check` prints and exits with.
 */

const lock = {
  name: 'co-sign',
  version: '0.1.0',
  lockfileVersion: 3,
  packages: {
    '': { name: 'co-sign', version: '0.1.0', license: 'MIT' },
    'node_modules/alpha': { version: '1.0.0', license: 'MIT' },
    'node_modules/beta': { version: '2.1.0', license: 'MIT' },
    'node_modules/gamma': { version: '3.0.0', license: 'Apache-2.0' },
    'node_modules/agpl-thing': { version: '0.4.0', license: 'AGPL-3.0' },
    'node_modules/lgpl-thing': { version: '5.0.0', license: 'LGPL-3.0-or-later' },
    'node_modules/no-licence': { version: '0.0.1' },
    'node_modules/devtool': { version: '9.9.9', license: 'MIT', dev: true },
    'node_modules/devtool/node_modules/dev-dep': { version: '1.2.3', license: 'ISC', dev: true },
  },
};

const reviewed = { 'lgpl-thing': 'Loaded as a separate module, never modified.' };

function section(md, heading) {
  const start = md.indexOf(`## ${heading}`);
  if (start === -1) return '';
  const next = md.indexOf('\n## ', start + 1);
  return next === -1 ? md.slice(start) : md.slice(start, next);
}

function flaggedLine(md, id) {
  return section(md, 'Flagged')
    .split('\n')
    .find((l) => l.includes(id));
}

describe('collect', () => {
  it('returns one entry per package with name, version, licence and the runtime/dev split', () => {
    const { collect } = require('../../scripts/third-party-licenses/generate.js');
    const byName = Object.fromEntries(collect(lock).map((e) => [e.name, e]));
    expect(byName.alpha).toEqual({ name: 'alpha', version: '1.0.0', license: 'MIT', dev: false });
    expect(byName.devtool).toEqual({ name: 'devtool', version: '9.9.9', license: 'MIT', dev: true });
    expect(byName['dev-dep']).toEqual({ name: 'dev-dep', version: '1.2.3', license: 'ISC', dev: true });
    expect(byName['no-licence'].license).toBeNull();
  });

  it('skips the root package', () => {
    const { collect } = require('../../scripts/third-party-licenses/generate.js');
    const names = collect(lock).map((e) => e.name).sort();
    expect(names).toEqual([
      'agpl-thing',
      'alpha',
      'beta',
      'dev-dep',
      'devtool',
      'gamma',
      'lgpl-thing',
      'no-licence',
    ]);
  });
});

describe('render', () => {
  it('puts runtime and dev packages in separate sections', () => {
    const { collect, render } = require('../../scripts/third-party-licenses/generate.js');
    const md = render(collect(lock), reviewed);
    const runtime = section(md, 'Runtime');
    const dev = section(md, 'Dev');
    expect(runtime).toContain('alpha@1.0.0');
    expect(runtime).not.toContain('devtool@9.9.9');
    expect(dev).toContain('devtool@9.9.9');
    expect(dev).toContain('dev-dep@1.2.3');
    expect(dev).not.toContain('alpha@1.0.0');
  });

  it('groups packages under one heading per licence', () => {
    const { collect, render } = require('../../scripts/third-party-licenses/generate.js');
    const runtime = section(render(collect(lock), reviewed), 'Runtime');
    const mit = runtime.indexOf('### MIT');
    const apache = runtime.indexOf('### Apache-2.0');
    expect(mit).toBeGreaterThan(-1);
    expect(apache).toBeGreaterThan(-1);
    expect(runtime.split('### MIT').length).toBe(2);
    const mitBlock = runtime.slice(mit, runtime.indexOf('###', mit + 1));
    expect(mitBlock).toContain('alpha@1.0.0');
    expect(mitBlock).toContain('beta@2.1.0');
    expect(mitBlock).not.toContain('gamma@3.0.0');
  });

  it('flags an AGPL package as NOT REVIEWED', () => {
    const { collect, render } = require('../../scripts/third-party-licenses/generate.js');
    const line = flaggedLine(render(collect(lock), reviewed), 'agpl-thing@0.4.0');
    expect(line).toBeDefined();
    expect(line).toContain('NOT REVIEWED');
  });

  it('shows the reviewed reason for a reviewed LGPL package', () => {
    const { collect, render } = require('../../scripts/third-party-licenses/generate.js');
    const line = flaggedLine(render(collect(lock), reviewed), 'lgpl-thing@5.0.0');
    expect(line).toBeDefined();
    expect(line).toContain('Loaded as a separate module, never modified.');
    expect(line).not.toContain('NOT REVIEWED');
  });

  it('flags a package with no licence', () => {
    const { collect, render } = require('../../scripts/third-party-licenses/generate.js');
    const line = flaggedLine(render(collect(lock), reviewed), 'no-licence@0.0.1');
    expect(line).toBeDefined();
    expect(line).toContain('NOT REVIEWED');
  });

  it('does not flag MIT, Apache-2.0 or ISC packages', () => {
    const { collect, render } = require('../../scripts/third-party-licenses/generate.js');
    const flagged = section(render(collect(lock), reviewed), 'Flagged');
    expect(flagged).not.toContain('alpha@');
    expect(flagged).not.toContain('gamma@');
    expect(flagged).not.toContain('dev-dep@');
  });

  // issue #262: wrap width raised from 100 to 800 so the real lockfile's list stays under 300 lines.
  it('wraps long package lists to about 800 characters per line', () => {
    const { render } = require('../../scripts/third-party-licenses/generate.js');
    const entries = [];
    for (let i = 0; i < 40; i += 1) {
      entries.push({ name: `package-number-${i}`, version: '1.0.0', license: 'MIT', dev: false });
    }
    const runtime = section(render(entries, {}), 'Runtime');
    const listLines = runtime.split('\n').filter((l) => l.includes('package-number-'));
    expect(listLines.length).toBeGreaterThan(1);
    for (const l of listLines) expect(l.length).toBeLessThanOrEqual(800); // issue #262: WIDTH is now 800
    for (let i = 0; i < 40; i += 1) expect(runtime).toContain(`package-number-${i}@1.0.0`);
  });
});

describe('check (what --check prints and exits with)', () => {
  it('lists NOT REVIEWED packages and returns exit code 1', () => {
    const { collect, check } = require('../../scripts/third-party-licenses/generate.js');
    const result = check(collect(lock), reviewed);
    expect(result.code).toBe(1);
    expect(result.output).toContain('agpl-thing@0.4.0');
    expect(result.output).toContain('no-licence@0.0.1');
    expect(result.output).not.toContain('lgpl-thing@5.0.0');
  });

  it('returns exit code 0 when every flagged package is reviewed', () => {
    const { collect, check } = require('../../scripts/third-party-licenses/generate.js');
    const all = { ...reviewed, 'agpl-thing': 'Dev tooling only.', 'no-licence': 'Own code.' };
    expect(check(collect(lock), all).code).toBe(0);
  });
});
