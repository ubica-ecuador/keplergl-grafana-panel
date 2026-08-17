import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { RootContext } from '@kepler.gl/components';
import KeplerPortaled from '@kepler.gl/components/common/portaled';

import PortaledBodyMount from './portaledBodyMount';

/**
 * KeplerGl provides RootContext pointing at its own root div, and Portaled
 * mounts every dropdown's react-modal there. Inside a Grafana panel that div
 * sits under a CSS-transformed `.react-grid-item`, which re-bases Portaled's
 * `position: fixed` viewport coordinates to the panel — dropdowns opened
 * shifted down by the panel's offset and clipped at its edge. The wrapper
 * under test severs that context so react-modal falls back to document.body,
 * where fixed coordinates mean what kepler computed.
 */

function renderInsideKeplerRoot(ui: React.ReactElement, rootRef: React.RefObject<HTMLDivElement>) {
  return render(
    <ThemeProvider theme={theme}>
      <RootContext.Provider value={rootRef}>{ui}</RootContext.Provider>
    </ThemeProvider>
  );
}

describe('PortaledBodyMount', () => {
  let fakeKeplerRoot: HTMLDivElement;

  beforeEach(() => {
    fakeKeplerRoot = document.createElement('div');
    document.body.appendChild(fakeKeplerRoot);
  });

  afterEach(() => {
    fakeKeplerRoot.remove();
  });

  it("mounts the portal on document.body, outside kepler's root", () => {
    renderInsideKeplerRoot(
      <PortaledBodyMount isOpened={true} left={0} top={0}>
        <div data-testid="portal-child">options</div>
      </PortaledBodyMount>,
      { current: fakeKeplerRoot }
    );

    const child = document.querySelector('[data-testid="portal-child"]');
    expect(child).not.toBeNull();
    expect(document.body.contains(child)).toBe(true);
    expect(fakeKeplerRoot.contains(child)).toBe(false);
  });

  it("documents the assumption: kepler's own Portaled mounts into the RootContext node", () => {
    // If this ever fails, kepler stopped parenting dropdowns to its root and
    // the wrapper (plus its webpack module replacement) can likely be removed.
    renderInsideKeplerRoot(
      <KeplerPortaled isOpened={true} left={0} top={0}>
        <div data-testid="portal-child">options</div>
      </KeplerPortaled>,
      { current: fakeKeplerRoot }
    );

    const child = document.querySelector('[data-testid="portal-child"]');
    expect(child).not.toBeNull();
    expect(fakeKeplerRoot.contains(child)).toBe(true);
  });
});
