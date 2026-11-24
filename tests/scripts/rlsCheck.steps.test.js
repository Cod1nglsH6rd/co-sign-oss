/**
 * scripts/db/rlsCheck.js turns one row-level-security case into the ordered
 * statements a runner executes inside its transaction, fills in the seeded
 * values the case needs from the fixture, and tells a permission error apart
 * from other database errors. Nothing here touches a database.
 */

function load() {
  return require('../../scripts/db/rlsCheck');
}

const USER_B = '22222222-2222-4222-8222-222222222222';
const PARAMS = {
  orgADocumentId: '77777777-7777-4777-8777-777777777777',
  orgASessionId: '99999999-9999-4999-8999-999999999999',
  userBDocumentId: '88888888-8888-4888-8888-888888888888',
  orgAObjectName: '33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.pdf',
};

const ANON_CASE = {
  id: 'anon:select:public.documents',
  role: 'anon',
  table: 'public.documents',
  action: 'select',
  sql: 'SELECT id FROM public.documents WHERE id = $1',
  params: ['orgADocumentId'],
  expect: 'none',
};
const AUTH_CASE = {
  id: 'authenticated:delete:storage.objects',
  role: 'authenticated',
  table: 'storage.objects',
  action: 'delete',
  sql: 'DELETE FROM storage.objects WHERE name = $1 RETURNING id',
  params: ['orgAObjectName'],
  expect: 'none',
};

const texts = (steps) => steps.map((s) => s.text);

describe('caseSteps', () => {
  test('an anon case sets the role and runs its sql between a savepoint and its rollback, with no claims', () => {
    const steps = load().caseSteps(ANON_CASE, PARAMS, USER_B);
    expect(texts(steps)).toEqual([
      'SAVEPOINT rls_case',
      'SET LOCAL ROLE anon',
      'SELECT id FROM public.documents WHERE id = $1',
      'ROLLBACK TO SAVEPOINT rls_case',
    ]);
    expect(texts(steps).some((t) => t.includes('set_config'))).toBe(false);
    expect(steps[2].values).toEqual(['77777777-7777-4777-8777-777777777777']);
  });

  test("an authenticated case sets claims carrying user B's id before its sql", () => {
    const steps = load().caseSteps(AUTH_CASE, PARAMS, USER_B);
    expect(texts(steps)).toEqual([
      'SAVEPOINT rls_case',
      'SET LOCAL ROLE authenticated',
      "SELECT set_config('request.jwt.claims', $1, true)",
      'DELETE FROM storage.objects WHERE name = $1 RETURNING id',
      'ROLLBACK TO SAVEPOINT rls_case',
    ]);
    expect(steps[2].values).toHaveLength(1);
    expect(JSON.parse(steps[2].values[0])).toEqual({ sub: USER_B, role: 'authenticated' });
    expect(steps[3].values).toEqual([PARAMS.orgAObjectName]);
  });

  test('the last step is always ROLLBACK TO SAVEPOINT rls_case', () => {
    for (const c of [ANON_CASE, AUTH_CASE]) {
      const steps = load().caseSteps(c, PARAMS, USER_B);
      expect(steps[steps.length - 1].text).toBe('ROLLBACK TO SAVEPOINT rls_case');
    }
  });

  test('an unknown role throws', () => {
    const { caseSteps } = load();
    expect(() => caseSteps({ ...ANON_CASE, role: 'service_role' }, PARAMS, USER_B)).toThrow();
    expect(() => caseSteps({ ...ANON_CASE, role: 'anon; DROP TABLE x' }, PARAMS, USER_B)).toThrow();
  });

  test('a param name the params lack throws', () => {
    const { caseSteps } = load();
    const { orgADocumentId, ...rest } = PARAMS;
    expect(() => caseSteps(ANON_CASE, rest, USER_B)).toThrow();
  });
});

describe('caseParams', () => {
  test("over a real buildFixture() output it gives org A's document ids and object name", () => {
    const { buildFixture } = require('../../scripts/db/rlsFixture');
    const fixture = buildFixture({
      orgA: '33333333-3333-4333-8333-333333333333',
      documentA: PARAMS.orgADocumentId,
      sessionA: PARAMS.orgASessionId,
      documentB: PARAMS.userBDocumentId,
    });
    // Was toEqual(PARAMS): caseParams now also gives the values the new cases
    // bind, checked below, so the four original values are matched one by one.
    expect(load().caseParams(fixture)).toMatchObject(PARAMS);
  });

  test("it gives the new cases org A's and user B's ids, both object names and the probe values", () => {
    const { buildFixture } = require('../../scripts/db/rlsFixture');
    const fixture = buildFixture();
    const { ids } = fixture;
    const params = load().caseParams(fixture);
    expect(params).toMatchObject({
      orgAId: ids.orgA,
      orgAFilledObjectName: `${ids.documentA}/${ids.sessionA}-filled.pdf`,
      userBId: ids.userB,
      userBOrgId: ids.orgB,
      userBMembershipId: ids.membershipB,
      userBSessionId: ids.sessionB,
      userBChatHistoryId: ids.chatHistoryB,
      appConfigKey: `rls-fixture-${ids.appConfig}`,
      betaSignupId: ids.betaSignup,
      probeDocumentId: ids.probeDocument,
      probeMembershipId: ids.probeMembership,
      adminRole: 'admin',
    });
    // Inserted objects go under org A's folder (documents) and org A's
    // document's folder (filled-documents), as the storage policies read them.
    expect(params.probeDocumentsObjectName.split('/')[0]).toBe(ids.orgA);
    expect(params.probeFilledObjectName.split('/')[0]).toBe(ids.documentA);
    // Every case's params resolve.
    const { buildCases } = require('../../scripts/db/rlsCases');
    for (const c of buildCases()) {
      expect(() => load().caseSteps(c, params, ids.userB)).not.toThrow();
    }
  });

  test.each(['filledObjectA', 'appConfig'])('it throws when the fixture insert for %s is missing', (key) => {
    const { buildFixture } = require('../../scripts/db/rlsFixture');
    const fixture = buildFixture();
    const statements = fixture.statements.filter(
      (s) => !s.values.some((v) => String(v).includes(fixture.ids[key]))
    );
    expect(statements).toHaveLength(fixture.statements.length - 1);
    expect(() => load().caseParams({ statements, ids: fixture.ids })).toThrow();
  });

  test('it throws when the org A storage object insert is missing', () => {
    const { buildFixture } = require('../../scripts/db/rlsFixture');
    const fixture = buildFixture();
    const statements = fixture.statements.filter(
      (s) => !(s.text.startsWith('INSERT INTO storage.objects') && s.values.includes(fixture.ids.documentsObjectA))
    );
    expect(() => load().caseParams({ statements, ids: fixture.ids })).toThrow();
  });

  test('it throws when an id is missing', () => {
    const { buildFixture } = require('../../scripts/db/rlsFixture');
    const fixture = buildFixture();
    const { sessionA, ...ids } = fixture.ids;
    expect(() => load().caseParams({ statements: fixture.statements, ids })).toThrow();
  });
});

describe('isPermissionError', () => {
  test("is true for code 42501 and false for 42P01, other codes or no error", () => {
    const { isPermissionError } = load();
    expect(isPermissionError({ code: '42501' })).toBe(true);
    expect(isPermissionError({ code: '42P01' })).toBe(false);
    expect(isPermissionError({ code: 42501 })).toBe(false);
    expect(isPermissionError({})).toBe(false);
    expect(isPermissionError(null)).toBe(false);
    expect(isPermissionError(undefined)).toBe(false);
  });
});
