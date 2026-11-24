/**
 * @jest-environment jsdom
 */

/**
 * The setup form's fields: provider and key, mail choice, site address,
 * masked saved keys and names set on the host. No fetch, no Save.
 */

const React = require('react');
const { render, within, fireEvent } = require('@testing-library/react/pure');

function loadForm() {
  try {
    const mod = require('../../components/SetupForm');
    return mod && mod.default ? mod.default : mod;
  } catch {
    return null;
  }
}

// Each render gets its own container; queries stay inside it, so no
// cleanup between tests is needed.
function renderForm(settings) {
  const SetupForm = loadForm();
  expect(typeof SetupForm).toBe('function');
  const { container } = render(
    React.createElement(SetupForm, { settings, onSave: () => {} })
  );
  return { container, view: within(container) };
}

function inputNamed(container, name) {
  return container.querySelector(`input[name="${name}"]`);
}

describe('SetupForm fields', () => {
  it('offers Anthropic (Claude) as provider with an empty key input', () => {
    const { container, view } = renderForm({});
    expect(view.getByRole('option', { name: 'Anthropic (Claude)' })).toBeTruthy();
    const key = view.getByLabelText('Anthropic API key');
    expect(key).toBe(inputNamed(container, 'ANTHROPIC_API_KEY'));
    expect(key.value).toBe('');
  });

  it('offers Resend or No mail, and Resend shows a key and a from-address input', () => {
    const { container, view } = renderForm({});
    const resend = view.getByLabelText('Resend');
    const none = view.getByLabelText('No mail: copy the signing link');
    expect(resend.type).toBe('radio');
    expect(none.type).toBe('radio');
    expect(resend.checked).toBe(true);
    expect(view.getByLabelText('Resend API key')).toBe(inputNamed(container, 'RESEND_API_KEY'));
    expect(view.getByLabelText('From address')).toBe(inputNamed(container, 'EMAIL_FROM'));
  });

  it('has a site address input that starts with the saved address', () => {
    const { container, view } = renderForm({
      NEXT_PUBLIC_APP_URL: { set: true, source: 'file', value: 'https://sign.example.org' },
    });
    const site = view.getByLabelText('Site address');
    expect(site).toBe(inputNamed(container, 'NEXT_PUBLIC_APP_URL'));
    expect(site.value).toBe('https://sign.example.org');
  });

  it('shows only the mask of a set key and starts its input empty', () => {
    const { container, view } = renderForm({
      ANTHROPIC_API_KEY: { set: true, source: 'file', value: 'sk-a…9f2c' },
    });
    expect(view.getByText((text) => text.includes('sk-a…9f2c'))).toBeTruthy();
    const key = inputNamed(container, 'ANTHROPIC_API_KEY');
    expect(key).not.toBeNull();
    expect(key.value).toBe('');
  });

  it('shows Set on the host and no editable input for a name set in env', () => {
    const { container, view } = renderForm({
      ANTHROPIC_API_KEY: { set: true, source: 'env', value: 'sk-a…9f2c' },
      NEXT_PUBLIC_APP_URL: { set: true, source: 'env', value: 'https://sign.example.org' },
    });
    expect(view.getAllByText('Set on the host')).toHaveLength(2);
    expect(inputNamed(container, 'ANTHROPIC_API_KEY')).toBeNull();
    expect(inputNamed(container, 'NEXT_PUBLIC_APP_URL')).toBeNull();
    expect(view.queryByLabelText('Anthropic API key')).toBeNull();
    expect(view.queryByLabelText('Site address')).toBeNull();
    // A name not set in env keeps its input.
    expect(inputNamed(container, 'RESEND_API_KEY')).not.toBeNull();
  });

  it('hides the Resend inputs when No mail is chosen', () => {
    const { container, view } = renderForm({});
    expect(inputNamed(container, 'RESEND_API_KEY')).not.toBeNull();
    fireEvent.click(view.getByLabelText('No mail: copy the signing link'));
    expect(view.getByLabelText('No mail: copy the signing link').checked).toBe(true);
    expect(inputNamed(container, 'RESEND_API_KEY')).toBeNull();
    expect(inputNamed(container, 'EMAIL_FROM')).toBeNull();
    expect(view.queryByLabelText('Resend API key')).toBeNull();
    expect(view.queryByLabelText('From address')).toBeNull();
  });

  it('starts on No mail when the saved mail provider is none', () => {
    const { container, view } = renderForm({
      EMAIL_PROVIDER: { set: true, source: 'file', value: 'none' },
    });
    expect(view.getByLabelText('No mail: copy the signing link').checked).toBe(true);
    expect(inputNamed(container, 'RESEND_API_KEY')).toBeNull();
  });
});
