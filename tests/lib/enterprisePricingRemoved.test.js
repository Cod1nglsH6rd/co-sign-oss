const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', '..', 'pages', 'enterprise', 'index.js');

describe('enterprise landing page without pricing', () => {
  const source = fs.readFileSync(PAGE, 'utf8');

  it.each(['#pricing', 'PLANS', '/mo'])('the page source has no %s', (text) => {
    expect(source).not.toContain(text);
  });

  it('has no billing toggle or pricing CSS', () => {
    expect(source).not.toMatch(/ent-billing-toggle|ent-pricing|setBilling/);
  });

  // Release review T5: the page is now a plain page (what the app is and a
  // sign-in link), so the features, security, demo and integrations sections
  // this used to expect are gone; it still renders with no pricing.
  it('renders the plain page with a sign-in link and no pricing section', () => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const EnterpriseLanding = require('../../pages/enterprise/index.js').default;

    const html = renderToStaticMarkup(React.createElement(EnterpriseLanding));

    expect(html).toContain('href="/enterprise/login"');
    expect(html).not.toContain('id="pricing"');
    expect(html).not.toContain('href="#pricing"');
    expect(html).not.toContain('Transparent Pricing');
    expect(html).not.toContain('Monthly');
  });
});
