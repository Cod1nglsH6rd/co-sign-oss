const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', '..', 'pages', '[locale]', 'settings.js');

describe('settings page without the Plan field', () => {
  const source = fs.readFileSync(PAGE, 'utf8');

  it('keeps no orgPlan state', () => {
    expect(source).not.toMatch(/orgPlan|setOrgPlan/);
  });

  it('selects the organization name but not its plan', () => {
    const match = source.match(/\.from\(\s*['"]organizations['"]\s*\)\s*\.select\(\s*['"]([^'"]*)['"]/);
    expect(match).not.toBeNull();
    const columns = match[1].split(',').map((c) => c.trim());
    expect(columns).toContain('name');
    expect(columns).not.toContain('plan');
  });

  it('has no Plan label', () => {
    expect(source).not.toMatch(/>\s*Plan\s*</);
  });
});
