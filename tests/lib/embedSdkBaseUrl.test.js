/**
 * public/embed-sdk.js finds the Cô Sign address from the script that loaded
 * it: document.currentScript's src, else the last <script> whose src names
 * embed-sdk. It has no built-in address of its own: when neither tells it
 * where it came from, init() throws instead of framing some other site.
 *
 * The SDK runs in a vm with a small fake DOM; addresses are example.com ones.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../public/embed-sdk.js'), 'utf8');

function load({ currentScript = null, scripts = [] } = {}) {
  const container = { innerHTML: 'x', children: [], appendChild(el) { this.children.push(el); } };
  const document = {
    currentScript,
    querySelectorAll: () => scripts,
    getElementById: (id) => (id === 'box' ? container : null),
    createElement: () => ({ style: {}, setAttribute() {} }),
  };
  const window = { addEventListener() {}, location: { origin: 'https://partner.example.com' } };
  const context = { window, document, URL };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  return { CosignEmbed: window.CosignEmbed, container };
}

describe('embed SDK base address', () => {
  it('uses the origin of document.currentScript', () => {
    const { CosignEmbed, container } = load({
      currentScript: { src: 'https://sign.example.com/embed-sdk.js?v=2' },
      scripts: [{ src: 'https://other.example.com/embed-sdk.js' }],
    });
    CosignEmbed.init({ containerId: 'box', token: 'tok' });
    expect(container.children[0].src).toBe('https://sign.example.com/embed/tok');
  });

  it('falls back to the last embed-sdk script tag', () => {
    const { CosignEmbed, container } = load({
      scripts: [{ src: 'https://a.example.com/embed-sdk.js' }, { src: 'https://sign.example.com/embed-sdk.js' }],
    });
    CosignEmbed.init({ containerId: 'box', token: 'tok', language: 'vi' });
    expect(container.children[0].src).toBe('https://sign.example.com/embed/tok?lang=vi');
  });

  it('with no script to go by, init throws and frames nothing', () => {
    const { CosignEmbed, container } = load({ scripts: [] });
    expect(() => CosignEmbed.init({ containerId: 'box', token: 'tok' })).toThrow(/embed-sdk\.js/);
    expect(container.children).toHaveLength(0);
  });

  it('a script src that is not a URL is no address', () => {
    const { CosignEmbed, container } = load({ currentScript: { src: '' }, scripts: [{ src: 'not a url' }] });
    expect(() => CosignEmbed.init({ containerId: 'box', token: 'tok' })).toThrow();
    expect(container.children).toHaveLength(0);
  });

  it('holds no hard-coded https address outside its usage comment', () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/https?:\/\/[^\s'"]+/g)).toBeNull();
  });
});
