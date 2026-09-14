import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { LAYER_VIS_CONFIGS } from '@kepler.gl/constants';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';
import { injector, provideRecipesToInjector, LayerConfiguratorFactory } from '@kepler.gl/components';

import { replaceLayerConfigurator } from './flowFieldConfigurator';
import { FLOW_FIELD_MESSAGES } from './flowFieldMessages';
import { VECTOR_FIELD_VIS_CONFIGS } from './vectorFieldLayer';

/** The vector field's panel, through the lookup kepler really uses, as text. */
function panelText(columnMode: string, visConfig: Record<string, unknown> = {}): string {
  const presets = LAYER_VIS_CONFIGS as unknown as Record<string, { defaultValue?: unknown }>;
  const visConfigSettings = Object.fromEntries(
    Object.entries(VECTOR_FIELD_VIS_CONFIGS as unknown as Record<string, unknown>).map(([key, setting]) => [
      key,
      typeof setting === 'string' ? presets[setting] : setting,
    ])
  ) as Record<string, { defaultValue?: unknown }>;
  const defaults = Object.fromEntries(Object.entries(visConfigSettings).map(([key, s]) => [key, s?.defaultValue]));
  const layer = {
    id: 'layer-1',
    type: 'vectorfield',
    config: {
      visConfig: { ...defaults, ...visConfig },
      columnMode,
      color: [255, 255, 255],
      colorUI: { colorRange: {} },
    },
    visConfigSettings,
    meta: { speedDomain: [2, 14] },
  };

  const appInjector = provideRecipesToInjector([replaceLayerConfigurator() as never], injector());
  const Configurator = appInjector.get(LayerConfiguratorFactory) as unknown as new (props: unknown) => object;
  const node = (Configurator.prototype as unknown as Record<string, (args: unknown) => React.ReactElement>)
    ._renderVectorfieldLayerConfig({
      layer,
      visConfiguratorProps: { layer, onChange: jest.fn() },
      layerConfiguratorProps: { layer, onChange: jest.fn() },
    });

  const { container } = render(
    <IntlProvider locale="en" messages={{ ...messages.en, ...FLOW_FIELD_MESSAGES }}>
      <ThemeProvider theme={theme}>{node}</ThemeProvider>
    </IntlProvider>
  );
  return container.textContent ?? '';
}

describe('the vector field panel', () => {
  it('asks for the data’s speed unit only for wind barbs, which count in knots', () => {
    expect(panelText('components', { symbol: 'barb' })).toContain('Data speed unit');
    expect(panelText('components', { symbol: 'arrow' })).not.toContain('Data speed unit');
  });

  it('offers the spacing only on the screen grid', () => {
    expect(panelText('components', { placement: 'screen' })).toContain('Spacing (px)');
    expect(panelText('components', { placement: 'cells' })).not.toContain('Spacing (px)');
  });

  it('offers a size range for classified arrows, and for arrows sized by speed', () => {
    expect(panelText('components', { symbol: 'classified' })).toContain('Size range (px)');
    expect(panelText('components', { symbol: 'arrow', sizeBySpeed: true })).toContain('Size range (px)');
    expect(panelText('components', { symbol: 'arrow', sizeBySpeed: false })).not.toContain('Size range (px)');
  });

  it('shows an arrow where a barb was chosen over a gradient', () => {
    // A slope has no knots; the layer draws an arrow, and the panel says so.
    const text = panelText('gradient', { symbol: 'barb' });

    expect(text).toContain('Arrow');
    expect(text).not.toContain('Wind barb');
  });

  it('asks which way a direction is read when the query spells it as one', () => {
    expect(panelText('polar')).toContain('Direction is');
    expect(panelText('components')).not.toContain('Direction is');
  });
});
