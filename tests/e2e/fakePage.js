/**
 * A stand-in for a Playwright page, for the offline tests of
 * tests/e2e/mainFlow.e2e.js. Every call is recorded in `actions`; none waits.
 *
 * fakePage({ responses, inputValues, evaluate, url }):
 * - responses: { '<urlPart>': { status, body, requestBody } } answers
 *   page.waitForResponse(responseTo('<urlPart>')).
 * - inputValues: { '<selector>': value } answers page.inputValue.
 * - evaluate(fnName, arg): answers page.evaluate by the function's name.
 * - elements: { '<selector>': count } answers page.$$ (default none).
 * - responses may also give a list of answers for one urlPart, used in turn
 *   (the last one again once the list is used up).
 * - texts: { '<selector>': text } answers page.textContent.
 * - gotoResponse(url): what page.goto(url) resolves to (default undefined).
 * - enabled: { '<selector>': false } answers page.isEnabled (default true).
 */

function fakeResponse({ status = 200, body = null, requestBody = null } = {}) {
  return {
    status: () => status,
    json: async () => body,
    url: () => '',
    request: () => ({ postDataJSON: () => requestBody, method: () => 'POST' }),
  };
}

function fakePage({
  responses = {}, inputValues = {}, evaluate = () => null, elements = {}, url = 'http://localhost:3000/',
  texts = {}, gotoResponse = () => undefined, enabled = {},
} = {}) {
  const actions = [];
  const record = (name) => (...args) => {
    actions.push([name, ...args]);
    return Promise.resolve();
  };
  const page = { actions };
  for (const name of ['fill', 'check', 'click', 'setInputFiles', 'waitForSelector', 'waitForURL', 'selectOption', 'reload', 'waitForTimeout']) {
    page[name] = record(name);
  }
  page.goto = (target, ...rest) => {
    actions.push(['goto', target, ...rest]);
    return Promise.resolve(gotoResponse(target));
  };
  const used = {};
  page.waitForResponse = (predicate) => {
    actions.push(['waitForResponse', predicate.urlPart, predicate.method]);
    let answer = responses[predicate.urlPart];
    if (Array.isArray(answer)) {
      const i = used[predicate.urlPart] || 0;
      used[predicate.urlPart] = i + 1;
      answer = answer[Math.min(i, answer.length - 1)];
    }
    if (!answer) return Promise.reject(new Error(`no fake response for ${predicate.urlPart}`));
    return Promise.resolve(fakeResponse(answer));
  };
  page.textContent = (selector) => {
    actions.push(['textContent', selector]);
    return Promise.resolve(texts[selector] === undefined ? null : texts[selector]);
  };
  page.inputValue = (selector) => {
    actions.push(['inputValue', selector]);
    return Promise.resolve(inputValues[selector]);
  };
  page.evaluate = (fn, arg) => {
    actions.push(['evaluate', fn.name, arg]);
    return Promise.resolve(evaluate(fn.name, arg));
  };
  page.$$ = (selector) => {
    actions.push(['$$', selector]);
    return Promise.resolve(new Array(elements[selector] || 0).fill({}));
  };
  page.isEnabled = (selector) => {
    actions.push(['isEnabled', selector]);
    return Promise.resolve(enabled[selector] === undefined ? true : enabled[selector]);
  };
  page.locator = (selector) => ({
    scrollIntoViewIfNeeded: () => {
      actions.push(['scrollIntoViewIfNeeded', selector]);
      return Promise.resolve();
    },
    boundingBox: () => {
      actions.push(['boundingBox', selector]);
      return Promise.resolve({ x: 100, y: 200, width: 520, height: 160 });
    },
  });
  page.mouse = { move: record('mouse.move'), down: record('mouse.down'), up: record('mouse.up') };
  page.url = () => url;
  return page;
}

// A stand-in for fetch: answers by URL part, in the order the parts are listed.
function fakeFetch(routes) {
  const calls = [];
  const fn = (url, init = {}) => {
    calls.push({ url, init });
    const route = routes.find(([part]) => String(url).includes(part));
    if (!route) return Promise.reject(new Error(`no fake answer for ${url}`));
    const answer = typeof route[1] === 'function' ? route[1](url, init, calls) : route[1];
    const { status = 200, body = null, bytes = null } = answer;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      arrayBuffer: async () => {
        const data = Buffer.from(bytes || []);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      },
    });
  };
  fn.calls = calls;
  return fn;
}

module.exports = { fakePage, fakeFetch, fakeResponse };
