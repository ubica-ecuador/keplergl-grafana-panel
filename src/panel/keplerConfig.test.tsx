import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { AnimationJsonEditorControlFactory, AnimationJsonEditorFactory } from '@kepler.gl/components';
import { messages } from '@kepler.gl/localization';
import { theme } from '@kepler.gl/styles';
import { getApplicationConfig } from '@kepler.gl/utils';

import { configureKepler } from './keplerConfig';

/**
 * kepler.gl 3.3.0-alpha.14 put a `{ }` JSON editor on the time widget, on by
 * default. That widget sits on the map for everyone who opens the dashboard,
 * side panel or not, and whatever is typed into it is gone on the next refresh.
 * The editors on the layer, filter and effect cards stay: the side panel is
 * already where a map is edited.
 */
describe('configureKepler — the JSON editors', () => {
  beforeAll(() => configureKepler());

  it('leaves the time widget without one', () => {
    const Control = AnimationJsonEditorControlFactory(AnimationJsonEditorFactory());
    const { container } = render(
      <IntlProvider locale="en" messages={messages.en}>
        <ThemeProvider theme={theme}>
          <Control />
        </ThemeProvider>
      </IntlProvider>
    );

    expect(container.querySelector('.animation-json-control-button')).toBeNull();
  });

  it('keeps the ones on the side panel cards', () => {
    const config = getApplicationConfig();

    expect(config.enableJsonEditors).toBe(true);
    expect(config.enableLayerJsonEditor).toBe(true);
    expect(config.enableFilterJsonEditor).toBe(true);
    expect(config.enableEffectJsonEditor).toBe(true);
  });
});
