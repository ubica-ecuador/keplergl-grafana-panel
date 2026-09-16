import React from 'react';
import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';

import { replaceLayerConfigurator } from './flowFieldConfigurator';
import { SymbolLayerConfig } from './symbolConfigurator';
import { SYMBOL_MESSAGES } from './symbolMessages';
import { SYMBOL_TYPE, SYMBOL_VIS_CONFIGS } from './symbolLayer';

describe('symbol layer panel', () => {
  it('is found by the name kepler builds from the layer type', () => {
    // kepler calls `_render${capitalize(type)}LayerConfig` on the configurator.
    // Deriving the name from the type here means a rename of either fails this
    // test instead of silently emptying the panel.
    const [, Factory] = replaceLayerConfigurator();
    const deps = (Factory as unknown as { deps: unknown[] }).deps.map(() => () => null);
    const Configurator = (Factory as unknown as (...args: unknown[]) => new () => unknown)(...deps);

    const method = `_render${SYMBOL_TYPE.charAt(0).toUpperCase()}${SYMBOL_TYPE.slice(1)}LayerConfig`;

    expect(method).toBe('_renderSymbolLayerConfig');
    expect(typeof (Configurator.prototype as Record<string, unknown>)[method]).toBe('function');
  });

  it('shows the rotation and size groups', () => {
    const layer = {
      id: 'layer-1',
      type: SYMBOL_TYPE,
      config: { visConfig: { symbol: 'arrow', directionConvention: 'towards' }, colorField: null, colorUI: {} },
      visConfigSettings: {},
      visualChannels: {
        angle: { key: 'angle', property: 'angle' },
        size: { key: 'size', property: 'size' },
        color: { key: 'color', property: 'color' },
      },
    };

    render(
      <IntlProvider locale="en" messages={{ ...messages.en, ...SYMBOL_MESSAGES }}>
        <ThemeProvider theme={theme}>
          <SymbolLayerConfig
            layer={layer}
            visConfiguratorProps={{ layer, onChange: () => undefined }}
            layerConfiguratorProps={{ layer, onChange: () => undefined }}
            layerChannelConfigProps={{ layer, fields: [], onChange: () => undefined }}
          />
        </ThemeProvider>
      </IntlProvider>
    );

    expect(screen.getByText('Rotation')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
  });

  it('offers the raw-column switch for both rotation and size once a column is bound', () => {
    // Regression coverage: `fixedSize` was registered by the layer and had a
    // message, but the size group never rendered its switch — there was no
    // way to reach it from the panel. `fixedAngle`'s switch is the one this
    // mirrors, and is asserted here too so a future regression on that side
    // fails the same way.
    const layer = {
      id: 'layer-1',
      type: SYMBOL_TYPE,
      config: {
        visConfig: { symbol: 'arrow', directionConvention: 'towards', fixedAngle: true, fixedSize: false },
        colorField: null,
        colorUI: {},
        angleField: { name: 'heading' },
        sizeField: { name: 'weight' },
      },
      visConfigSettings: { fixedAngle: SYMBOL_VIS_CONFIGS.fixedAngle, fixedSize: SYMBOL_VIS_CONFIGS.fixedSize },
      visualChannels: {
        angle: { key: 'angle', property: 'angle' },
        size: { key: 'size', property: 'size' },
        color: { key: 'color', property: 'color' },
      },
    };

    render(
      <IntlProvider locale="en" messages={{ ...messages.en, ...SYMBOL_MESSAGES }}>
        <ThemeProvider theme={theme}>
          <SymbolLayerConfig
            layer={layer}
            visConfiguratorProps={{ layer, onChange: () => undefined }}
            layerConfiguratorProps={{ layer, onChange: () => undefined }}
            layerChannelConfigProps={{ layer, fields: [], onChange: () => undefined }}
          />
        </ThemeProvider>
      </IntlProvider>
    );

    expect(screen.getByText('Use the column’s degrees')).toBeInTheDocument();
    expect(screen.getByText('Use the column’s number')).toBeInTheDocument();
  });
});
