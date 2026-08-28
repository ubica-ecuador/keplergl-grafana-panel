import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';
import { injector, provideRecipesToInjector, LayerConfiguratorFactory } from '@kepler.gl/components';

import { COG_PAINTED_TYPE } from './cogPaintedLayer';
import { ESRI_IMAGE_TYPE } from './esriImageLayer';
import { replaceLayerConfigurator } from './flowFieldConfigurator';
import { PaintedTilesetConfig } from './paintedTilesetConfigurator';

/** kepler's own opacity definition, so the slider under test is the real one. */
const OPACITY_SETTING = {
  type: 'number',
  defaultValue: 0.8,
  label: 'layerVisConfigs.opacity',
  isRanged: false,
  range: [0, 1],
  step: 0.01,
  property: 'opacity',
};

const layerOf = (type: string) => ({
  id: 'layer-1',
  type,
  config: { visConfig: { opacity: 0.8 } },
  visConfigSettings: { opacity: OPACITY_SETTING },
});

function renderConfig(node: React.ReactElement) {
  return render(
    <IntlProvider locale="en" messages={messages.en}>
      <ThemeProvider theme={theme}>{node}</ThemeProvider>
    </IntlProvider>
  );
}

describe('PaintedTilesetConfig', () => {
  it('puts the opacity the layer registered in front of the user', () => {
    // The whole point. A tileset whose picture arrives already drawn has no
    // ramp and no bands to offer, so opacity is the only thing left — and
    // without a configurator kepler shows none of it, however the layer
    // declares itself.
    const layer = layerOf(ESRI_IMAGE_TYPE);
    const { container } = renderConfig(
      // `visConfiguratorProps` carries the layer as well as the handler; that is
      // how kepler spreads it into every slider it renders.
      <PaintedTilesetConfig layer={layer as never} visConfiguratorProps={{ layer, onChange: jest.fn() } as never} />
    );

    expect(container.textContent).toContain('Opacity');
  });

  it('renders nothing rather than throwing when the layer registered no opacity', () => {
    // A layer mid-construction, or one that never asked. An exception here
    // takes the whole side panel down with it.
    const bare = { ...layerOf(ESRI_IMAGE_TYPE), visConfigSettings: {} };
    const { container } = renderConfig(
      <PaintedTilesetConfig layer={bare as never} visConfiguratorProps={{ layer: bare, onChange: jest.fn() } as never} />
    );

    expect(container).toBeTruthy();
  });
});

describe('the configurator kepler will actually look up', () => {
  /** kepler's rule: `_render` + the capitalised layer type + `LayerConfig`. */
  const methodFor = (type: string) => `_render${type.charAt(0).toUpperCase()}${type.slice(1)}LayerConfig`;

  function resolveConfigurator() {
    // The recipe's factory types are kepler's own and do not line up with the
    // injector's generic shape; the effects control's test casts the same way.
    const appInjector = provideRecipesToInjector([replaceLayerConfigurator() as never], injector());
    return appInjector.get(LayerConfiguratorFactory) as unknown as new (props: unknown) => object;
  }

  it.each([
    ['painted COG', COG_PAINTED_TYPE],
    ['Image Service', ESRI_IMAGE_TYPE],
    ['Zarr', 'zarr'],
  ])('grows the method kepler looks for on a %s layer', (_name, type) => {
    // Derived from the layer's own type rather than written out, so renaming a
    // type breaks this test instead of silently emptying its panel — the exact
    // fragility the flow field's configurator warns about in its comment.
    const Configurator = resolveConfigurator();

    expect(typeof (Configurator.prototype as Record<string, unknown>)[methodFor(type)]).toBe('function');
  });
});
