import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';

import { resetPictureStateForTests } from './pictureState';
import { sourcePatch, SymbolLayerConfig } from './symbolConfigurator';
import { SYMBOL_MESSAGES } from './symbolMessages';
import { SYMBOL_TYPE, SYMBOL_VIS_CONFIGS } from './symbolLayer';

const settings = Object.fromEntries(
  [
    'symbolSource',
    'pictureAnchor',
    'symbol',
    'upright',
    'outline',
    'outlineThickness',
    'shadow',
    'shadowOpacity',
    'shadowDistance',
    'gradient',
    'gradientTail',
  ].map((key) => [key, (SYMBOL_VIS_CONFIGS as unknown as Record<string, Record<string, unknown>>)[key]])
);

function renderPanel(visConfig: Record<string, unknown>) {
  const onChange = jest.fn();
  const layer = {
    id: 'layer-1',
    type: SYMBOL_TYPE,
    config: {
      visConfig: { symbol: 'arrow', directionConvention: 'towards', outlineColor: [255, 255, 255], ...visConfig },
      colorField: null,
      colorUI: {},
    },
    visConfigSettings: settings,
    visualChannels: {
      angle: { key: 'angle', property: 'angle' },
      size: { key: 'size', property: 'size' },
      color: { key: 'color', property: 'color' },
    },
  };
  const utils = render(
    <IntlProvider locale="en" messages={{ ...messages.en, ...SYMBOL_MESSAGES }}>
      <ThemeProvider theme={theme}>
        <SymbolLayerConfig
          layer={layer}
          visConfiguratorProps={{ layer, onChange }}
          layerConfiguratorProps={{ layer, onChange: () => undefined }}
          layerChannelConfigProps={{ layer, fields: [], onChange: () => undefined }}
        />
      </ThemeProvider>
    </IntlProvider>
  );
  return { onChange, ...utils };
}

describe('sourcePatch', () => {
  it('stands pictures upright on the way in from shapes', () => {
    expect(sourcePatch({ symbolSource: 'picture' }, 'shape')).toEqual({ symbolSource: 'picture', upright: true });
    expect(sourcePatch({ symbolSource: 'picture' }, undefined)).toEqual({ symbolSource: 'picture', upright: true });
  });

  it('leaves every other change as it is', () => {
    expect(sourcePatch({ symbolSource: 'picture' }, 'picture')).toEqual({ symbolSource: 'picture' });
    expect(sourcePatch({ symbolSource: 'shape' }, 'picture')).toEqual({ symbolSource: 'shape' });
    expect(sourcePatch({ symbolSize: 40 }, 'shape')).toEqual({ symbolSize: 40 });
  });
});

describe('the symbol layer panel, drawing shapes or pictures', () => {
  // kepler's dropdown pages its options in with an IntersectionObserver, which
  // jsdom lacks; see `selectKnob.test.tsx`.
  const scope = globalThis as { IntersectionObserver?: unknown };
  let original: unknown;
  beforeAll(() => {
    original = scope.IntersectionObserver;
    scope.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  afterAll(() => {
    scope.IntersectionObserver = original;
  });
  beforeEach(() => resetPictureStateForTests());

  it('offers the shape picker, outline, shadow and colour while drawing shapes', () => {
    renderPanel({ symbolSource: 'shape' });

    expect(screen.getByText('Draw')).toBeInTheDocument();
    expect(screen.getByText('Shape')).toBeInTheDocument();
    expect(screen.getByText('Outline')).toBeInTheDocument();
    expect(screen.getByText('Shadow')).toBeInTheDocument();
    expect(screen.getByText('Color')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('https://…')).not.toBeInTheDocument();
  });

  it('offers the picture, its anchor, rotation and size — and nothing cut from glyphs — while drawing pictures', () => {
    renderPanel({ symbolSource: 'picture', pictureUrl: 'https://example.org/pin.png' });

    expect(screen.getByPlaceholderText('https://…')).toBeInTheDocument();
    expect(screen.getByText('Anchor')).toBeInTheDocument();
    expect(screen.getByText('Rotation')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    for (const gone of ['Shape', 'Outline', 'Shadow', 'Color', 'Lighten towards the tail']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
  });

  it('stands pictures upright in the same change that chooses them', () => {
    const { onChange, container } = renderPanel({ symbolSource: 'shape' });

    // The Draw selector is the first of the panel's selectors.
    fireEvent.click(container.querySelector('.item-selector__dropdown') as HTMLElement);
    const option = [...document.body.querySelectorAll('.list__item')].find((item) => item.textContent === 'A picture');
    fireEvent.click(option as HTMLElement);

    expect(onChange).toHaveBeenCalledWith({ symbolSource: 'picture', upright: true });
  });
});
