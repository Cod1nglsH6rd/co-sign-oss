/**
 * @jest-environment jsdom
 */

/**
 * The setup screen (Phase1SetupModal, as /enterprise/setup uses it) when the
 * document has no fields: the message, the add-field form already open, the
 * no-AI-key line, and a field added by hand that gets a box on the page at
 * once, can be dragged, and is handed to onComplete with its position. While
 * the fields are still loading, none of that shows yet.
 *
 * react-pdf is replaced by a Document that reports 1 page and a Page that
 * reports a rendered size of 500 x 1000 px, so box pixels are page percent
 * times 5 (across) or 10 (down).
 */

const React = require('react');
const { render, within, fireEvent } = require('@testing-library/react/pure');

jest.mock('react-pdf', () => {
  const ReactInMock = require('react');
  return {
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({ children, onLoadSuccess }) => {
      ReactInMock.useEffect(() => {
        if (onLoadSuccess) onLoadSuccess({ numPages: 1 });
      }, []);
      return ReactInMock.createElement('div', { 'data-testid': 'pdf-document' }, children);
    },
    Page: ({ pageNumber, onRenderSuccess }) => {
      ReactInMock.useEffect(() => {
        if (onRenderSuccess) onRenderSuccess({ width: 500, height: 1000 });
      }, []);
      return ReactInMock.createElement('div', { 'data-testid': 'pdf-page' }, `page ${pageNumber}`);
    },
  };
});

beforeAll(() => {
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

const NO_FIELDS_TEXT = 'No fields were found. Add each field and drag it onto the page.';

const translations = {
  en: {
    setup: {
      add: 'Add',
      cancel: 'Cancel',
      fieldTypes: { text: 'Text', signature: 'Signature', checkbox: 'Checkbox' },
    },
  },
};

function setupProps(extraProps = {}) {
  return {
    isOpen: true,
    embedded: true,
    minimal: true,
    initialStep: 2,
    fields: [],
    fileUrl: 'https://files.example.org/lease.pdf',
    fileType: 'pdf',
    fileName: 'lease.pdf',
    translations,
    ...extraProps,
  };
}

function loadModal() {
  const mod = require('../../components/Phase1SetupModal');
  return mod && mod.default ? mod.default : mod;
}

function renderSetup(extraProps = {}) {
  const Phase1SetupModal = loadModal();
  const onComplete = jest.fn();
  const { container, rerender } = render(
    React.createElement(Phase1SetupModal, setupProps({ onComplete, ...extraProps }))
  );
  const update = (nextProps) => rerender(
    React.createElement(Phase1SetupModal, setupProps({ onComplete, ...nextProps }))
  );
  return { container, view: within(container), onComplete, update };
}

function boxesOnPage(container) {
  const pageEl = container.querySelector('[data-testid="pdf-page"]');
  expect(pageEl).toBeTruthy();
  return Array.from(pageEl.parentElement.children).filter((el) => el !== pageEl);
}

function px(value) {
  return parseFloat(value);
}

function addField(view, name, type = 'text') {
  if (!view.queryByPlaceholderText('Field name')) {
    fireEvent.click(view.getByRole('button', { name: /add field/i }));
  }
  fireEvent.change(view.getByPlaceholderText('Field name'), { target: { value: name } });
  fireEvent.change(view.getByDisplayValue('Text'), { target: { value: type } });
  fireEvent.click(view.getByRole('button', { name: 'Add' }));
}

describe('setup screen with zero fields', () => {
  it('says no fields were found and has the add-field form open', () => {
    const { view } = renderSetup();
    expect(view.getByText(NO_FIELDS_TEXT)).toBeTruthy();
    expect(view.getByPlaceholderText('Field name')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('says automatic field detection is off when the reason is no_ai_key', () => {
    const { view } = renderSetup({ noFieldsReason: 'no_ai_key' });
    expect(view.getByText(NO_FIELDS_TEXT)).toBeTruthy();
    expect(view.getByText(/automatic field detection is off/i)).toBeTruthy();
  });

  it('does not mention field detection when there is no no_ai_key reason', () => {
    const { view } = renderSetup();
    expect(view.getByText(NO_FIELDS_TEXT)).toBeTruthy();
    expect(view.queryByText(/automatic field detection is off/i)).toBeNull();
  });

  it('does not show the no-fields message when the document has fields', () => {
    const { view } = renderSetup({
      fields: [{ id: 'f1', field_name: 'Tenant name', field_type: 'text', position: null }],
      noFieldsReason: 'no_ai_key',
    });
    expect(view.queryByText(NO_FIELDS_TEXT)).toBeNull();
    expect(view.queryByText(/automatic field detection is off/i)).toBeNull();
    expect(view.queryByPlaceholderText('Field name')).toBeNull();
  });

  it('shows nothing about missing fields while the fields are still loading', () => {
    const { view, update } = renderSetup({ fieldsLoading: true, noFieldsReason: 'no_ai_key' });
    expect(view.queryByText(NO_FIELDS_TEXT)).toBeNull();
    expect(view.queryByText(/automatic field detection is off/i)).toBeNull();
    expect(view.queryByPlaceholderText('Field name')).toBeNull();

    // Loading ends with fields: still nothing about missing fields.
    update({
      fieldsLoading: false,
      noFieldsReason: 'no_ai_key',
      fields: [{ id: 'f1', field_name: 'Tenant name', field_type: 'text', position: null }],
    });
    expect(view.queryByText(NO_FIELDS_TEXT)).toBeNull();
    expect(view.queryByPlaceholderText('Field name')).toBeNull();
  });

  it('shows the message and opens the form once loading ends with zero fields', () => {
    const { view, update } = renderSetup({ fieldsLoading: true });
    expect(view.queryByText(NO_FIELDS_TEXT)).toBeNull();
    expect(view.queryByPlaceholderText('Field name')).toBeNull();

    update({ fieldsLoading: false });
    expect(view.getByText(NO_FIELDS_TEXT)).toBeTruthy();
    expect(view.getByPlaceholderText('Field name')).toBeTruthy();
  });

  it('gives a field added by hand a box on the page at once, at the default spot', () => {
    const { container, view } = renderSetup();
    expect(boxesOnPage(container)).toHaveLength(0);
    addField(view, 'Tenant name');
    const boxes = boxesOnPage(container);
    expect(boxes).toHaveLength(1);
    // x 12%, y 18%, 22% wide on a 500 x 1000 page
    expect(px(boxes[0].style.left)).toBeCloseTo(60, 3);
    expect(px(boxes[0].style.top)).toBeCloseTo(180, 3);
    expect(px(boxes[0].style.width)).toBeCloseTo(110, 3);
  });

  it('puts a second hand-added field one row lower, not on top of the first', () => {
    const { container, view } = renderSetup();
    addField(view, 'Tenant name');
    addField(view, 'Tenant signature', 'signature');
    const boxes = boxesOnPage(container);
    expect(boxes).toHaveLength(1);
    // second row: y 25%; signature 28% wide, 5% high
    expect(px(boxes[0].style.left)).toBeCloseTo(60, 3);
    expect(px(boxes[0].style.top)).toBeCloseTo(250, 3);
    expect(px(boxes[0].style.width)).toBeCloseTo(140, 3);
    expect(px(boxes[0].style.height)).toBeCloseTo(50, 3);
  });

  it('lets the box be dragged and saves the field with its new position', () => {
    const { container, view, onComplete } = renderSetup();
    addField(view, 'Tenant name');
    const [box] = boxesOnPage(container);

    fireEvent.mouseDown(box, { clientX: 100, clientY: 100 });
    // 50 px right = 10% of 500; 100 px down = 10% of 1000
    fireEvent.mouseMove(window, { clientX: 150, clientY: 200 });
    fireEvent.mouseUp(window);

    const [moved] = boxesOnPage(container);
    expect(px(moved.style.left)).toBeCloseTo(110, 3);
    expect(px(moved.style.top)).toBeCloseTo(280, 3);

    fireEvent.click(view.getByRole('button', { name: /save & continue/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const saved = onComplete.mock.calls[0][0].fields;
    expect(saved).toHaveLength(1);
    expect(saved[0].field_type).toBe('text');
    expect(saved[0].position).toEqual({
      page: 1, x: 22, y: 28, width: 22, height: 3, source: 'manual',
    });
  });
});
