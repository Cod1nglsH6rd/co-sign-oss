/**
 * Security floor for direct dependencies with critical advisories (issue #74).
 *
 * Reads the resolved versions from package-lock.json, so it fails if a later
 * lockfile change silently moves either package back below its patched release.
 *
 * - next: 15.5.29 is the patched 15.x release (GHSA-2464-fhr4-w9xw,
 *   GHSA-p3m5-59mp-jv5r and the earlier 15.5.x advisories). Stays on 15.x.
 * - @sentry/nextjs: 10.75.2 fixes the tunnel-route middleware bypass
 *   (GHSA-mchm-gjx6-7h55). Stays on 10.x.
 */
const fs = require('fs');
const path = require('path');

const lock = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package-lock.json'), 'utf8')
);

function installedVersion(name) {
  const entry = lock.packages && lock.packages[`node_modules/${name}`];
  if (!entry || !entry.version) {
    throw new Error(`${name} is missing from package-lock.json`);
  }
  return entry.version;
}

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version);
  if (!match) throw new Error(`unparseable version ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

function atLeast(version, floor) {
  const a = parse(version);
  const b = parse(floor);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key];
  }
  // Same x.y.z: a prerelease of the floor is older than the floor itself.
  return !a.prerelease;
}

const FLOORS = [
  { name: 'next', floor: '15.5.29', major: 15 },
  { name: '@sentry/nextjs', floor: '10.75.2', major: 10 },
];

describe('dependency security floor (package-lock.json)', () => {
  it.each(FLOORS)('$name is at or above $floor and stays on major $major', ({ name, floor, major }) => {
    const version = installedVersion(name);
    expect(parse(version).prerelease).toBeNull();
    expect(parse(version).major).toBe(major);
    expect(atLeast(version, floor)).toBe(true);
  });

  it('compares versions numerically, not as strings', () => {
    expect(atLeast('15.5.100', '15.5.29')).toBe(true);
    expect(atLeast('15.5.3', '15.5.29')).toBe(false);
    expect(atLeast('15.5.29-canary.1', '15.5.29')).toBe(false);
    expect(atLeast('10.76.0', '10.75.2')).toBe(true);
  });
});
