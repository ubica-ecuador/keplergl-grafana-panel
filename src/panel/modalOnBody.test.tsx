import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { ModalDialogFactory } from '@kepler.gl/components';

import { MODAL_OVERLAY_Z_INDEX, onDocumentBody } from './modalOnBody';

/**
 * kepler's ModalContainer hands its dialog `parentSelector={() => rootNode}`,
 * KeplerGl's own root div. Inside a Grafana panel that div sits under a
 * CSS-transformed, clipping `.react-grid-item`, so the data table's 90vw × 85vh
 * dialog was cut to the panel, close button included. The wrapper under test
 * mounts it on document.body whatever parent it is handed.
 */

type DialogProps = React.ComponentProps<ReturnType<typeof onDocumentBody>>;
const StockDialog = ModalDialogFactory() as unknown as React.ComponentType<DialogProps>;
const DialogOnBody = onDocumentBody(StockDialog);

describe('onDocumentBody', () => {
  let fakeKeplerRoot: HTMLDivElement;

  beforeEach(() => {
    fakeKeplerRoot = document.createElement('div');
    document.body.appendChild(fakeKeplerRoot);
  });

  afterEach(() => {
    fakeKeplerRoot.remove();
  });

  const renderDialog = (Dialog: React.ComponentType<DialogProps>, props: DialogProps = {}) =>
    render(
      <ThemeProvider theme={theme}>
        <Dialog isOpen={true} parentSelector={() => fakeKeplerRoot} onCancel={() => undefined} {...props}>
          <div data-testid="dialog-child">rows</div>
        </Dialog>
      </ThemeProvider>
    );

  it("mounts the dialog on document.body, outside kepler's root", () => {
    renderDialog(DialogOnBody);

    const child = document.querySelector('[data-testid="dialog-child"]');
    expect(child).not.toBeNull();
    expect(document.body.contains(child)).toBe(true);
    expect(fakeKeplerRoot.contains(child)).toBe(false);
  });

  it("documents the assumption: kepler's dialog mounts into the parent it is handed", () => {
    // If this ever fails, kepler stopped honouring parentSelector and the
    // recipe needs another way to reach document.body.
    renderDialog(StockDialog);

    expect(fakeKeplerRoot.contains(document.querySelector('[data-testid="dialog-child"]'))).toBe(true);
  });

  it("lays the overlay over Grafana's docked menu, keeping kepler's backdrop colour", () => {
    renderDialog(DialogOnBody);

    const overlay = document.querySelector<HTMLElement>('.ReactModal__Overlay');
    expect(overlay?.style.zIndex).toBe(String(MODAL_OVERLAY_Z_INDEX));
    expect(overlay?.style.backgroundColor).not.toBe('');
  });

  it('closes from its close button', () => {
    const onCancel = jest.fn();
    renderDialog(DialogOnBody, { onCancel });

    const close = document.querySelector('.modal--close');
    expect(close).not.toBeNull();
    fireEvent.click(close as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
