import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';

import { symbolsIn } from './symbolCategories';
import { SYMBOL_MESSAGES } from './symbolMessages';
import { SymbolPicker } from './symbolPicker';

/** The symbol knob as the symbol layer registers it; the picker supplies the options. */
function layerDrawing(symbol: string) {
  return {
    config: { visConfig: { symbol } },
    visConfigSettings: { symbol: { type: 'select', defaultValue: 'arrow', label: 'symbol.symbol' } },
  };
}

function renderPicker(symbol: string) {
  const onChange = jest.fn();
  const { container } = render(
    <IntlProvider locale="en" messages={{ ...messages.en, ...SYMBOL_MESSAGES }}>
      <ThemeProvider theme={theme}>
        <SymbolPicker layer={layerDrawing(symbol)} visConfiguratorProps={{ onChange }} />
      </ThemeProvider>
    </IntlProvider>
  );
  return { container, onChange };
}

/** The selector under the side-panel label that reads `label`. */
function selector(container: HTMLElement, label: string): HTMLElement {
  const section = [...container.querySelectorAll('.side-panel-panel__label')]
    .find((element) => element.textContent === label)
    ?.closest('.side-panel-section');
  const dropdown = section?.querySelector('.item-selector__dropdown');
  if (!dropdown) {
    throw new Error(`No selector labelled ${label}`);
  }
  return dropdown as HTMLElement;
}

const listed = () => [...document.body.querySelectorAll('.list__item')].map((item) => item.textContent);

/** Clicks the open list's option that reads `text`. */
function choose(text: string) {
  const option = [...document.body.querySelectorAll('.list__item')].find((item) => item.textContent === text);
  if (!option) {
    throw new Error(`No option ${text} among ${listed().join(', ')}`);
  }
  fireEvent.click(option);
}

describe('SymbolPicker', () => {
  // kepler's dropdown list pages its options in with an IntersectionObserver,
  // which jsdom lacks; without a stand-in the list throws on mount and kepler's
  // `Portaled` error boundary re-mounts it forever.
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

  it('puts the category above the symbol, open on the category of the symbol in use', () => {
    const { container } = renderPicker('ocha:flood');

    const labels = [...container.querySelectorAll('.side-panel-panel__label')].map((label) => label.textContent);
    expect(labels).toEqual(['Category', 'Shape']);
    expect(selector(container, 'Category').textContent).toBe('Hazards');
    expect(selector(container, 'Shape').querySelector('canvas')?.getAttribute('data-symbol')).toBe('ocha:flood');
  });

  it('opens a new layer’s arrow on the shapes', () => {
    const { container } = renderPicker('arrow');

    expect(selector(container, 'Category').textContent).toBe('Shapes');
  });

  it('opens on All for one of kepler’s hidden icons, and still shows it as the one in use', () => {
    const { container } = renderPicker('directions');

    expect(selector(container, 'Category').textContent).toBe('All');
    expect(selector(container, 'Shape').querySelector('canvas')?.getAttribute('data-symbol')).toBe('directions');
  });

  it('shows the arrow, not the unknown name, for a saved symbol this build cannot draw', () => {
    const { container } = renderPicker('no-such-glyph');

    // Not offered anywhere, so there is no category of its own to open on.
    expect(selector(container, 'Category').textContent).toBe('All');
    // The name and its preview must agree: the map draws the arrow for a name
    // it does not have, so the picker shows the arrow too, not a name whose
    // picture is really something else. `arrow` is the first option of All.
    expect(selector(container, 'Shape').querySelector('canvas')?.getAttribute('data-symbol')).toBe('arrow');
  });

  it('draws nothing for a layer that registers no symbol knob', () => {
    const { container } = render(
      <IntlProvider locale="en" messages={{ ...messages.en, ...SYMBOL_MESSAGES }}>
        <ThemeProvider theme={theme}>
          <SymbolPicker
            layer={{ config: { visConfig: { symbol: 'arrow' } }, visConfigSettings: {} }}
            visConfiguratorProps={{ onChange: jest.fn() }}
          />
        </ThemeProvider>
      </IntlProvider>
    );

    expect(container.querySelector('.side-panel-section')).toBeNull();
  });

  it('lists every category in the taxonomy’s words, All first, with nothing to type into', () => {
    const { container } = renderPicker('arrow');

    fireEvent.click(selector(container, 'Category'));

    expect(listed()).toEqual([
      'All',
      'Shapes',
      'Hazards',
      'Weather',
      'Emergency & health',
      'Damage & impact',
      'Transport',
      'Roads & traffic',
      'Power & utilities',
      'Telecom',
      'Water',
      'Nature & landforms',
      'Buildings & services',
      'Recreation & sport',
      'Food & shopping',
      'People & society',
      'Tools & industry',
    ]);
    expect(document.body.querySelector('.typeahead__input')).toBeNull();
  });

  it('narrows the symbols to the category chosen, without changing the one drawn', () => {
    const { container, onChange } = renderPicker('arrow');

    fireEvent.click(selector(container, 'Category'));
    choose('Hazards');

    expect(onChange).not.toHaveBeenCalled();
    expect(selector(container, 'Category').textContent).toBe('Hazards');
    // The arrow is not a hazard, and is still the symbol in use.
    expect(selector(container, 'Shape').querySelector('canvas')?.getAttribute('data-symbol')).toBe('arrow');

    fireEvent.click(selector(container, 'Shape'));
    expect(listed()).toEqual(symbolsIn('hazards'));

    choose('ocha:flood');
    expect(onChange).toHaveBeenCalledWith({ symbol: 'ocha:flood' });
  });
});
