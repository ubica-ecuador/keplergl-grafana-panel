import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';
import { injector, provideRecipesToInjector, LayerConfiguratorFactory } from '@kepler.gl/components';

import { replaceLayerConfigurator } from './flowFieldConfigurator';
import { Tile3dLayerConfig } from './tile3dConfigurator';
import { TILE3D_ALTITUDE_VIS_CONFIGS } from './tile3dAltitudeLayer';
import { TILE3D_MESSAGES } from './tile3dMessages';

/** kepler's own opacity definition, so the slider under test is the real one. */
const OPACITY_SETTING = {
  type: 'number',
  defaultValue: 1,
  label: 'layerVisConfigs.opacity',
  isRanged: false,
  range: [0, 1],
  step: 0.01,
  property: 'opacity',
};

const layer = {
  id: 'malla',
  type: 'tile3d',
  config: {
    visConfig: { opacity: 1, groundTileset: true, altitudeOffset: 0 },
    color: [255, 255, 255],
    // kepler's colour selector reads `config.colorUI[property]` for the state
    // of its own popover, and throws rather than defaulting when it is absent.
    colorUI: { color: {} },
  },
  visConfigSettings: {
    opacity: OPACITY_SETTING,
    ...TILE3D_ALTITUDE_VIS_CONFIGS,
  },
};

function renderConfig(node: React.ReactElement) {
  return render(
    <IntlProvider locale="en" messages={{ ...messages.en, ...TILE3D_MESSAGES }}>
      <ThemeProvider theme={theme}>{node}</ThemeProvider>
    </IntlProvider>
  );
}

describe('Tile3dLayerConfig', () => {
  it('puts both altitude knobs in front of the user', () => {
    // The reason this configurator exists. A tileset surveyed on a hill draws
    // in mid-air and, past a certain camera, not at all — so a panel that does
    // not offer these leaves the user with a layer that shows nothing and no
    // way to find out why.
    const { container } = renderConfig(
      <Tile3dLayerConfig
        layer={layer as never}
        visConfiguratorProps={{ layer, onChange: jest.fn() } as never}
        layerConfiguratorProps={{ layer, onChange: jest.fn(), setColorUI: jest.fn() } as never}
      />
    );

    expect(container.textContent).toContain('Sit on the ground');
    expect(container.textContent).toContain('Height adjustment');
  });

  it('keeps the settings kepler already showed', () => {
    const { container } = renderConfig(
      <Tile3dLayerConfig
        layer={layer as never}
        visConfiguratorProps={{ layer, onChange: jest.fn() } as never}
        layerConfiguratorProps={{ layer, onChange: jest.fn(), setColorUI: jest.fn() } as never}
      />
    );

    expect(container.textContent).toContain('Opacity');
  });

  it('renders rather than throwing when the layer has registered nothing yet', () => {
    // A layer mid-construction. An exception here takes the whole side panel
    // down with it.
    const bare = { ...layer, visConfigSettings: {} };
    const { container } = renderConfig(
      <Tile3dLayerConfig
        layer={bare as never}
        visConfiguratorProps={{ layer: bare, onChange: jest.fn() } as never}
        layerConfiguratorProps={{ layer: bare, onChange: jest.fn(), setColorUI: jest.fn() } as never}
      />
    );

    expect(container).toBeTruthy();
  });
});

describe('the configurator kepler will actually look up', () => {
  it('grows the method kepler looks for on a 3D tile layer', () => {
    // kepler's rule: `_render` + the capitalised layer type + `LayerConfig`.
    // Spelled `Tile3d`, not `Tile3D` — kepler capitalises only the first letter
    // of the type, and getting that wrong empties the panel in silence.
    const appInjector = provideRecipesToInjector([replaceLayerConfigurator() as never], injector());
    const Configurator = appInjector.get(LayerConfiguratorFactory) as unknown as new (props: unknown) => object;

    expect(typeof (Configurator.prototype as Record<string, unknown>)._renderTile3dLayerConfig).toBe('function');
  });
});
