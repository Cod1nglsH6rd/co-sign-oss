/**
 * @jest-environment jsdom
 */

/**
 * The setup form's Save: it hands onSave only the edited answers, shows
 * 'Checking…' while onSave runs, puts each returned error next to its field,
 * and shows the new masks after a save. No fetch: onSave is a plain function.
 */

const React = require('react');
const { render, within, fireEvent, waitFor, act } = require('@testing-library/react');

function loadForm() {
  try {
    const mod = require('../../components/SetupForm');
    return mod && mod.default ? mod.default : mod;
  } catch {
    return null;
  }
}

function renderForm(settings, onSave) {
  const SetupForm = loadForm();
  expect(typeof SetupForm).toBe('function');
  const { container } = render(React.createElement(SetupForm, { settings, onSave }));
  return { container, view: within(container) };
}

function inputNamed(container, name) {
  return container.querySelector(`input[name="${name}"]`);
}

function type(container, name, value) {
  fireEvent.change(inputNamed(container, name), { target: { value } });
}

function saveButton(view) {
  return view.getByRole('button', { name: 'Save' });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SAVED = {
  ANTHROPIC_API_KEY: { set: true, source: 'file', value: 'sk-a…9f2c' },
  EMAIL_PROVIDER: { set: true, source: 'file', value: 'resend' },
  NEXT_PUBLIC_APP_URL: { set: true, source: 'file', value: 'https://sign.example.org' },
};

describe('SetupForm Save', () => {
  it('sends only the edited names and never a blank key', async () => {
    const onSave = jest.fn().mockResolvedValue({ settings: SAVED });
    const { container, view } = renderForm(SAVED, onSave);
    type(container, 'ANTHROPIC_API_KEY', 'sk-ant-new');
    type(container, 'RESEND_API_KEY', '   ');
    fireEvent.click(saveButton(view));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-new' });
    await waitFor(() => expect(saveButton(view).disabled).toBe(false));
  });

  it("sends EMAIL_PROVIDER 'none' when No mail is chosen", async () => {
    const onSave = jest.fn().mockResolvedValue({ settings: SAVED });
    const { view } = renderForm(SAVED, onSave);
    fireEvent.click(view.getByLabelText('No mail: copy the signing link'));
    fireEvent.click(saveButton(view));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toEqual({ EMAIL_PROVIDER: 'none' });
    await waitFor(() => expect(saveButton(view).disabled).toBe(false));
  });

  it("shows 'Checking…' and disables Save until onSave settles", async () => {
    const pending = deferred();
    const onSave = jest.fn(() => pending.promise);
    const { container, view } = renderForm(SAVED, onSave);
    type(container, 'ANTHROPIC_API_KEY', 'sk-ant-new');
    const button = saveButton(view);
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toBe('Checking…'));
    expect(button.disabled).toBe(true);
    // A second click while checking does not call onSave again.
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ settings: SAVED });
      await pending.promise;
    });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent).toBe('Save');
  });

  it('shows each returned error next to its field and keeps the typed values', async () => {
    const onSave = jest.fn().mockResolvedValue({
      errors: {
        ANTHROPIC_API_KEY: 'Anthropic refused that key.',
        NEXT_PUBLIC_APP_URL: 'Type the full address, starting with https://.',
      },
    });
    const { container, view } = renderForm(SAVED, onSave);
    type(container, 'ANTHROPIC_API_KEY', 'sk-ant-bad');
    type(container, 'NEXT_PUBLIC_APP_URL', 'sign example');
    fireEvent.click(saveButton(view));
    await waitFor(() =>
      expect(inputNamed(container, 'ANTHROPIC_API_KEY')).toHaveAccessibleDescription(
        'Anthropic refused that key.'
      )
    );
    expect(inputNamed(container, 'NEXT_PUBLIC_APP_URL')).toHaveAccessibleDescription(
      'Type the full address, starting with https://.'
    );
    // A field with no error gets no message.
    expect(inputNamed(container, 'EMAIL_FROM')).not.toHaveAccessibleDescription(
      'Anthropic refused that key.'
    );
    expect(inputNamed(container, 'ANTHROPIC_API_KEY').value).toBe('sk-ant-bad');
    expect(inputNamed(container, 'NEXT_PUBLIC_APP_URL').value).toBe('sign example');
    expect(saveButton(view).disabled).toBe(false);
  });

  it('empties the key inputs and shows the new masks after a save', async () => {
    const after = {
      ANTHROPIC_API_KEY: { set: true, source: 'file', value: 'sk-a…new1' },
      RESEND_API_KEY: { set: true, source: 'file', value: 're_…new2' },
      EMAIL_PROVIDER: { set: true, source: 'file', value: 'resend' },
      NEXT_PUBLIC_APP_URL: { set: true, source: 'file', value: 'https://sign.example.org' },
    };
    const onSave = jest.fn().mockResolvedValue({ settings: after });
    const { container, view } = renderForm(SAVED, onSave);
    type(container, 'ANTHROPIC_API_KEY', 'sk-ant-new');
    type(container, 'RESEND_API_KEY', 're_new');
    fireEvent.click(saveButton(view));
    await waitFor(() => expect(container.textContent).toContain('sk-a…new1'));
    expect(container.textContent).toContain('re_…new2');
    expect(container.textContent).not.toContain('sk-a…9f2c');
    expect(inputNamed(container, 'ANTHROPIC_API_KEY').value).toBe('');
    expect(inputNamed(container, 'RESEND_API_KEY').value).toBe('');
  });

  it('re-enables Save with a plain message when onSave rejects', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('network down'));
    const { container, view } = renderForm(SAVED, onSave);
    type(container, 'ANTHROPIC_API_KEY', 'sk-ant-new');
    fireEvent.click(saveButton(view));
    await waitFor(() => expect(container.textContent).toContain('Could not save, try again.'));
    expect(container.textContent).not.toContain('network down');
    expect(saveButton(view).disabled).toBe(false);
    expect(inputNamed(container, 'ANTHROPIC_API_KEY').value).toBe('sk-ant-new');
  });
});
