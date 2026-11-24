// 2026-11-21: the schema job in
// .github/workflows/ci.yml builds an empty database from the repository alone
// (the stack's db, auth and storage services, then its migrate service:
// SUPABASE-SETUP.sql and every migration), runs scripts/db/schemaCheck.js and
// scripts/db/rlsCheck.js against it, and always takes it all down. This pins
// the job's shape: where and when it runs, its steps in order, no secrets, no
// published port, no database address in the file, and the README line.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { scanText } = require('../../scripts/secretScan');

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const COMPOSE_FILE = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

// The text of one job: from its `  name:` line to the next job or the end.
function jobText(name) {
  const lines = WORKFLOW.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end])) end += 1;
  // Comments just above the next job belong to it.
  while (end > start + 1 && /^ {2}#/.test(lines[end - 1])) end -= 1;
  return lines.slice(start, end).join('\n').trimEnd();
}

// Each step as { name, id, if, run }, comment lines left out of run.
function steps(job) {
  return job.split(/\n\s{6}- name: /).slice(1).map((chunk) => {
    const [name, ...rest] = chunk.split('\n');
    const body = rest.join('\n');
    const field = (key) => {
      const m = new RegExp(`\\n {8}${key}: (.+)`).exec(`\n${body}`);
      return m ? m[1].trim() : null;
    };
    const run = /\n {8}run: \|?\s*([\s\S]*)$/.exec(`\n${body}`);
    const text = run
      ? run[1].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').replace(/\s*\\\n\s*/g, ' ').trim()
      : '';
    return { name: name.trim(), id: field('id'), if: field('if'), run: text };
  });
}

const schema = jobText('schema');
const changes = jobText('changes');
const all = schema ? steps(schema) : [];
const step = (name) => all.find((s) => s.name === name);

const MIGRATE = 'Empty database, then the baseline and every migration';
const SCHEMA = 'Schema check';
const RLS = 'Row-level security check';
const DOWN = 'Take everything down with its volumes';
const AFTER_MIGRATE = "${{ !cancelled() && steps.migrate.outcome == 'success' }}";

describe('CI schema job (co-sign-430)', () => {
  it('exists, with a time limit', () => {
    expect(schema).not.toBeNull();
    expect(schema).toMatch(/\n {4}timeout-minutes: \d+\n/);
  });

  it("runs where e2e runs (both need Docker): CI_E2E_RUNS_ON, GitHub's ubuntu-24.04 when unset", () => {
    expect(schema).toContain(`runs-on: \${{ fromJSON(vars.CI_E2E_RUNS_ON || '"ubuntu-24.04"') }}`);
  });

  it('runs on pushes to main, and on pull requests only when the changes job says so', () => {
    expect(WORKFLOW).toMatch(/\non:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n/);
    expect(schema).toMatch(/\n {4}needs: changes\n/);
    const cond = /\n {4}if: \$\{\{ (.+) \}\}\n/.exec(schema);
    expect(cond).not.toBeNull();
    expect(cond[1]).toBe(
      "!cancelled() && (vars.CI_E2E_RUNS_ON != '' || vars.CI_RUNS_ON == '') && " +
        "(github.event_name != 'pull_request' || needs.changes.outputs.schema == 'true')"
    );
  });

  it('gives each run its own Compose project, since a self-hosted runner keeps Docker state', () => {
    expect(schema).toMatch(
      /\n {4}env:\n {6}COMPOSE_PROJECT_NAME: cosign-schema-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\n/
    );
  });

  it('uses no service or job container (the self-hosted runner cannot start them)', () => {
    expect(schema).not.toMatch(/\n {4}(services|container):/);
  });

  it('starts only the database services and migrate, then waits for migrate and checks it applied every file', () => {
    const run = step(MIGRATE).run;
    expect(step(MIGRATE).id).toBe('migrate');
    expect(run.split('\n')[0]).toBe('docker compose up -d --build db auth storage migrate');
    expect(run).not.toMatch(/\b(app|gateway)\b/);
    expect(run).toContain('migrate=$(docker compose ps -aq migrate)');
    expect(run).toContain('code=$(docker wait "$migrate")');
    expect(run).toContain('docker compose logs --no-color migrate');
    expect(run).toContain('[ "$code" = 0 ] || exit 1');
    expect(run).toContain('files=$(( $(ls supabase/migrations/*.sql | wc -l) + 1 ))');
    expect(run).toContain('grep -q "done: $files applied"');
  });

  it('runs the schema check, then the RLS check, in the migrate image on the stack network', () => {
    expect(step(SCHEMA).run).toBe('docker compose run --rm --no-deps -T migrate node scripts/db/schemaCheck.js');
    expect(step(RLS).run).toBe('docker compose run --rm --no-deps -T migrate node scripts/db/rlsCheck.js');
    // Both run once migrate succeeded, so a failing schema check still shows the RLS result.
    expect(step(SCHEMA).if).toBe(AFTER_MIGRATE);
    expect(step(RLS).if).toBe(AFTER_MIGRATE);
  });

  it('runs its three steps in order: migrations, schema check, RLS check', () => {
    const names = all.map((s) => s.name);
    const order = [MIGRATE, SCHEMA, RLS].map((n) => names.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(names[0]).toBe('Checkout');
  });

  it('always takes the stack down with its volumes as the last step, and checks nothing is left', () => {
    const last = all[all.length - 1];
    expect(last.name).toBe(DOWN);
    expect(last.if).toBe('always()');
    expect(last.run.split('\n')[0]).toBe('docker compose down -v --remove-orphans --rmi local');
    expect(last.run).toContain('label=com.docker.compose.project=$COMPOSE_PROJECT_NAME');
    expect(last.run).toContain('[ -z "$left" ] ||');
  });

  it('keeps its self-hosted steps to a self-hosted runner, and its failure dump to the container states', () => {
    const own = all.filter((s) => /self-hosted/.test(s.name));
    expect(own.map((s) => s.name)).toEqual(['Watch memory (self-hosted)', 'Memory (self-hosted)']);
    expect(own.map((s) => s.if)).toEqual(["runner.environment == 'self-hosted'", "always() && runner.environment == 'self-hosted'"]);
    expect(step('Container states').if).toBe('failure()');
    // The only logs it prints are migrate's own (file names and errors).
    const dumps = all.filter((s) => /docker (compose .*)?logs\b/.test(s.run));
    expect(dumps.map((s) => s.name)).toEqual([MIGRATE]);
    const logs = schema.match(/docker compose logs\b[^|\n]*/g).map((s) => s.trim());
    expect([...new Set(logs)]).toEqual(['docker compose logs --no-color migrate']);
  });

  it('publishes no port', () => {
    expect(schema).not.toMatch(/\bports:|\s-p\s|--publish|--service-ports/);
  });

  it('never mentions secrets', () => {
    expect(WORKFLOW).not.toMatch(/secrets/i);
  });

  it('holds no database address or password: the stack makes its own', () => {
    expect(scanText(WORKFLOW, '.github/workflows/ci.yml').filter((h) => h.kind === 'connection-string')).toEqual([]);
    expect(schema).not.toMatch(/postgres(ql)?:\/\//);
    expect(schema).not.toMatch(/DATABASE_URL|PGPASSWORD|POSTGRES_PASSWORD|supabase_admin/);
    // migrate (and so each check run with its image) gets the stack's own address.
    // 2026-11-21: it used to be written in the compose file with
    // the fixed default password; now the keys service writes it to the keys
    // volume (/keys/db.env, host db, from the password it made on first start)
    // and migrate's entrypoint loads it before any command, `run` ones included.
    const migrate = /\n {2}migrate:\n([\s\S]*?)\n {2}[a-z]+:\n/.exec(COMPOSE_FILE);
    expect(migrate).not.toBeNull();
    expect(migrate[1]).toContain('. /keys/db.env && export DATABASE_URL && exec "$$@"');
    expect(migrate[1]).toContain('- keys:/keys:ro');
    const genKeys = fs.readFileSync(path.join(ROOT, 'scripts', 'docker', 'gen-keys.js'), 'utf8');
    expect(genKeys).toContain("const DB_HOST = 'db:5432';");
  });
});

describe('the changes job decides whether schema runs on a pull request (co-sign-430)', () => {
  it('has a second output, schema, from its own step, and e2e keeps its own', () => {
    expect(changes).toContain('      e2e: ${{ steps.diff.outputs.e2e }}\n      schema: ${{ steps.schema.outputs.schema }}');
    const own = steps(changes).find((s) => s.id === 'schema');
    expect(own).toBeDefined();
    expect(own.name).toBe('Database files changed');
    expect(own.run).toContain('git diff --no-renames --name-only HEAD^1 HEAD');
  });

  // Runs the step's own script with a stand-in for git.
  function needsSchema(files, gitFails = false) {
    const own = steps(changes).find((s) => s.id === 'schema');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-changes-'));
    const out = path.join(dir, 'out');
    fs.writeFileSync(out, '');
    const stub = gitFails ? 'git() { return 1; }' : 'git() { printf "%s\\n" "$FILES"; }';
    try {
      execFileSync('bash', ['-e', '-c', `${stub}\n${own.run}`], {
        env: { ...process.env, FILES: files.join('\n'), GITHUB_OUTPUT: out },
        stdio: 'pipe',
      });
      return fs.readFileSync(out, 'utf8').trim();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('runs schema for the baseline, a migration, scripts/db, the compose file, the workflow or its own test', () => {
    for (const f of [
      'supabase/migrations/20261121000000_x.sql',
      'SUPABASE-SETUP.sql',
      'scripts/db/rlsCheck.js',
      'scripts/db/sub/x.js',
      'docker-compose.yml',
      '.github/workflows/ci.yml',
      'tests/scripts/ciSchemaJob.test.js',
    ]) {
      expect([f, needsSchema(['README.md', f])]).toEqual([f, 'schema=true']);
    }
  });

  it('skips schema for anything else', () => {
    expect(
      needsSchema(['README.md', 'pages/index.js', 'lib/sessions.js', 'tests/scripts/rlsCases.test.js', 'scripts/setup.sh', 'Dockerfile'])
    ).toBe('schema=false');
  });

  it('leaves the e2e job selected exactly as before', () => {
    const cond = /\n {4}if: \$\{\{ (.+) \}\}\n/.exec(jobText('e2e'));
    expect(cond[1]).toBe(
      "!cancelled() && (vars.CI_E2E_RUNS_ON != '' || vars.CI_RUNS_ON == '') && " +
        "(github.event_name != 'pull_request' || needs.changes.outputs.e2e == 'true')"
    );
  });

  it('runs schema when the changed files cannot be listed', () => {
    expect(needsSchema([], true)).toBe('schema=true');
    expect(needsSchema([])).toBe('schema=true');
  });
});

describe("the README's testing section names the schema job (co-sign-430)", () => {
  it('names the job, its checks, and says migrations are for fresh installs only, never a hosted database', () => {
    const start = README.indexOf('### Testing');
    expect(start).toBeGreaterThan(-1);
    const next = README.indexOf('\n### ', start + 1);
    const section = README.slice(start, next === -1 ? undefined : next);
    expect(section).toContain('`schema`');
    expect(section).toContain('scripts/db/schemaCheck.js');
    expect(section).toContain('scripts/db/rlsCheck.js');
    expect(section).toMatch(/fresh install/i);
    expect(section).toMatch(/never .*hosted database/i);
  });

  it("is named on the README's CI line too", () => {
    const line = README.split('\n').find((l) => l.startsWith('- **CI:**'));
    expect(line).toContain('`schema`');
  });
});
