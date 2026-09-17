import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('offers the raw-column switch for size, and deliberately none for rotation, once columns are bound', () => {
    // Regression coverage: `fixedSize` was registered by the layer and had a
    // message, but the size group never rendered its switch — there was no
    // way to reach it from the panel.
    //
    // `fixedAngle` is the opposite case, and asserted absent so nobody "fixes"
    // it back in: turned off, kepler rescales the bearing onto a range the
    // layer does not register, d3 throws, and the layer stops drawing.
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

    expect(screen.getByText('Use the column’s number')).toBeInTheDocument();
    expect(screen.queryByText('Use the column’s degrees')).not.toBeInTheDocument();
  });

  it('offers the declutter switch and its spacing slider once declutter is on', () => {
    // Regression coverage for task 9: `declutter` and `declutterSpacingPx` were
    // registered on the layer and had messages, but — like `fixedSize` before
    // it — nothing in the size group rendered a control for them.
    const layer = {
      id: 'layer-1',
      type: SYMBOL_TYPE,
      config: {
        visConfig: { symbol: 'arrow', directionConvention: 'towards', declutter: true, declutterSpacingPx: 40 },
        colorField: null,
        colorUI: {},
      },
      visConfigSettings: {
        declutter: SYMBOL_VIS_CONFIGS.declutter,
        declutterSpacingPx: SYMBOL_VIS_CONFIGS.declutterSpacingPx,
      },
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

    expect(screen.getByText('Thin overlapping symbols')).toBeInTheDocument();
    expect(screen.getByText('Minimum spacing (px)')).toBeInTheDocument();
  });

  it.each([
    [false, []],
    [true, ['Shadow intensity', 'Shadow distance (px)']],
  ])('offers the shadow switch, and its two sliders when it is on (%s)', (on, sliders) => {
    const layer = {
      id: 'layer-1',
      type: SYMBOL_TYPE,
      config: {
        visConfig: {
          symbol: 'arrow',
          directionConvention: 'towards',
          shadow: on,
          shadowOpacity: 0.5,
          shadowDistance: 4,
        },
        colorField: null,
        colorUI: {},
      },
      visConfigSettings: {
        shadow: SYMBOL_VIS_CONFIGS.shadow,
        shadowOpacity: SYMBOL_VIS_CONFIGS.shadowOpacity,
        shadowDistance: SYMBOL_VIS_CONFIGS.shadowDistance,
      } as unknown as Record<string, Record<string, unknown>>,
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

    expect(screen.getByText('Shadow')).toBeInTheDocument();
    for (const label of ['Shadow intensity', 'Shadow distance (px)']) {
      expect(screen.queryByText(label) !== null).toBe((sliders as string[]).includes(label));
    }
  });

  it('names shapes by their glyph names, and lets the long list be searched', () => {
    // Glyph names have no messages on purpose. Put through react-intl like the
    // other selectors, each option rendered as `symbol.symbol.airport` and
    // raised a missing-translation error of its own.
    const onError = jest.fn();
    const layer = {
      id: 'layer-1',
      type: SYMBOL_TYPE,
      config: { visConfig: { symbol: 'airport', directionConvention: 'towards' }, colorField: null, colorUI: {} },
      visConfigSettings: {
        symbol: SYMBOL_VIS_CONFIGS.symbol as unknown as Record<string, unknown>,
        directionConvention: SYMBOL_VIS_CONFIGS.directionConvention as unknown as Record<string, unknown>,
      },
      visualChannels: {
        angle: { key: 'angle', property: 'angle' },
        size: { key: 'size', property: 'size' },
        color: { key: 'color', property: 'color' },
      },
    };

    const { container } = render(
      <IntlProvider locale="en" messages={{ ...messages.en, ...SYMBOL_MESSAGES }} onError={onError}>
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

    expect(screen.getByText('airport')).toBeInTheDocument();
    // The small enumeration beside it is still translated.
    expect(screen.getByText('Where it goes')).toBeInTheDocument();

    // kepler's dropdown list pages its options in with an IntersectionObserver,
    // which jsdom lacks. Without a stand-in the list throws on mount, and
    // kepler's `Portaled` error boundary re-mounts it forever — a hung test, not
    // a failed one.
    const scope = globalThis as { IntersectionObserver?: unknown };
    const original = scope.IntersectionObserver;
    scope.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    try {
      const [shape] = container.querySelectorAll('.item-selector__dropdown');
      fireEvent.click(shape);

      const listed = () => [...document.body.querySelectorAll('.list__item')].map((item) => item.textContent);
      expect(listed().length).toBeGreaterThan(0);
      expect(listed().some((text) => text?.startsWith('symbol.'))).toBe(false);

      // Maki's bus sits hundreds of names down; typing finds it.
      const search = document.body.querySelector('.typeahead__input') as HTMLInputElement;
      expect(search).not.toBeNull();
      fireEvent.change(search, { target: { value: 'bus' } });
      expect(listed()).toContain('bus');
    } finally {
      scope.IntersectionObserver = original;
    }

    const missing = onError.mock.calls
      .map(([error]) => String(error?.message ?? ''))
      .filter((message) => message.includes('"symbol.symbol.'));
    expect(missing).toEqual([]);
  });

  it('draws each shape beside its name, in the list and in the chosen value', () => {
    // The drawing itself needs a 2D canvas, which jsdom lacks; what can be
    // checked here is that every option carries one, for its own glyph.
    const layer = {
      id: 'layer-1',
      type: SYMBOL_TYPE,
      config: { visConfig: { symbol: 'airport', directionConvention: 'towards' }, colorField: null, colorUI: {} },
      visConfigSettings: { symbol: SYMBOL_VIS_CONFIGS.symbol as unknown as Record<string, unknown> },
      visualChannels: {
        angle: { key: 'angle', property: 'angle' },
        size: { key: 'size', property: 'size' },
        color: { key: 'color', property: 'color' },
      },
    };

    const { container } = render(
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

    const [shape] = container.querySelectorAll('.item-selector__dropdown');
    expect(shape.querySelector('canvas')?.getAttribute('data-symbol')).toBe('airport');

    const scope = globalThis as { IntersectionObserver?: unknown };
    const original = scope.IntersectionObserver;
    scope.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    try {
      fireEvent.click(shape);
      const items = [...document.body.querySelectorAll('.list__item')];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.querySelector('canvas')?.getAttribute('data-symbol')).toBe(item.textContent);
      }
    } finally {
      scope.IntersectionObserver = original;
    }
  });
});
