import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { AnimationJsonEditorControlFactory, AnimationJsonEditorFactory } from '@kepler.gl/components';
import { messages } from '@kepler.gl/localization';
import { theme } from '@kepler.gl/styles';
import { getApplicationConfig } from '@kepler.gl/utils';
import { toggleModal, wrapTo } from '@kepler.gl/actions';
import { ADD_DATA_ID, EXPORT_MAP_ID } from '@kepler.gl/constants';

import { KEPLER_INSTANCE_ID } from './constants';
import { configureKepler, configureRasterServers, isAddDataModalOpening } from './keplerConfig';
import { createKeplerStore, onKeplerAction } from './keplerStore';

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

describe('configureKepler — the charts panel', () => {
  beforeAll(() => configureKepler());

  it('keeps it on, whatever kepler’s default becomes', () => {
    expect(getApplicationConfig().enableChartsPanel).toBe(true);
  });
});

/**
 * kepler's Add Data → Tileset → Raster Tile form starts from the page's
 * `rasterServerUrls`; each map puts its own panel option there as its dialog
 * opens (KeplerMap), heard through `onKeplerAction` before the reducer runs.
 */
describe('the raster servers of the Add Data form', () => {
  beforeAll(() => configureKepler());

  it('start empty: the panel names no server by default', () => {
    expect(getApplicationConfig().rasterServerUrls).toEqual([]);
  });

  it("are the map's own, set as its Add Data dialog opens", () => {
    const store = createKeplerStore();
    const stop = onKeplerAction(store, (action) => {
      if (isAddDataModalOpening(action)) {
        configureRasterServers(['https://tiler.internal']);
      }
    });

    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, toggleModal(EXPORT_MAP_ID)));
    expect(getApplicationConfig().rasterServerUrls).toEqual([]);

    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, toggleModal(ADD_DATA_ID)));
    expect(getApplicationConfig().rasterServerUrls).toEqual(['https://tiler.internal']);

    stop();
    configureRasterServers([]);
    expect(getApplicationConfig().rasterServerUrls).toEqual([]);
  });

  it('hear the dialog open whether the action is addressed to the map or not', () => {
    expect(isAddDataModalOpening(toggleModal(ADD_DATA_ID))).toBe(true);
    expect(isAddDataModalOpening(wrapTo(KEPLER_INSTANCE_ID, toggleModal(ADD_DATA_ID)))).toBe(true);
    expect(isAddDataModalOpening(toggleModal(null))).toBe(false);
    expect(isAddDataModalOpening({ type: 'OTHER', payload: ADD_DATA_ID })).toBe(false);
  });
});
