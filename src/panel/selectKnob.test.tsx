import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';

import { SelectKnob } from './selectKnob';

/** A knob as a layer registers it, with messages for its label and each option. */
const layer = {
  config: { visConfig: { placement: 'cells' } },
  visConfigSettings: {
    placement: { type: 'select', defaultValue: 'screen', options: ['screen', 'cells'], label: 'test.placement' },
  },
};

const catalogue = {
  ...messages.en,
  'test.placement': 'Placement',
  'test.placement.screen': 'Screen grid',
  'test.placement.cells': 'Data cells',
};

/** Renders the knob and opens its list, the way a click in the side panel does. */
function openKnob(extra: Partial<React.ComponentProps<typeof SelectKnob>> = {}) {
  const { container } = render(
    <IntlProvider locale="en" messages={catalogue}>
      <ThemeProvider theme={theme}>
        <SelectKnob
          layer={layer}
          visConfiguratorProps={{ onChange: () => undefined }}
          property="placement"
          {...extra}
        />
      </ThemeProvider>
    </IntlProvider>
  );
  fireEvent.click(container.querySelector('.item-selector__dropdown') as HTMLElement);
  return container;
}

/** Renders the knob drawing `placement`, without opening it. */
function renderKnob(placement: string, extra: Partial<React.ComponentProps<typeof SelectKnob>> = {}) {
  const { container } = render(
    <IntlProvider locale="en" messages={catalogue}>
      <ThemeProvider theme={theme}>
        <SelectKnob
          layer={{ ...layer, config: { visConfig: { placement } } }}
          visConfiguratorProps={{ onChange: () => undefined }}
          property="placement"
          {...extra}
        />
      </ThemeProvider>
    </IntlProvider>
  );
  return container.querySelector('.item-selector__dropdown') as HTMLElement;
}

describe('SelectKnob', () => {
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

  it('by default reads each option through its message and offers no search box', () => {
    // The flow field and vector field selectors rely on exactly this: a short
    // list, named in words, with nothing to type into.
    const container = openKnob();

    const listed = [...document.body.querySelectorAll('.list__item')].map((item) => item.textContent);
    expect(container.textContent).toContain('Placement');
    expect(listed).toEqual(['Screen grid', 'Data cells']);
    expect(document.body.querySelector('.typeahead__input')).toBeNull();
  });

  it('shows options in their own words, and searchable, when asked', () => {
    openKnob({ displayOption: (option) => option, searchable: true });

    const listed = [...document.body.querySelectorAll('.list__item')].map((item) => item.textContent);
    expect(listed).toEqual(['screen', 'cells']);
    expect(document.body.querySelector('.typeahead__input')).not.toBeNull();
  });

  it('shows the first option for a value it does not offer', () => {
    // What every other knob relies on: a stale value reads as the default.
    expect(renderKnob('gone').textContent).toBe('Screen grid');
  });

  it('keeps showing a value it does not offer, when asked to', () => {
    // The symbol picker's case: the symbol drawn is in another category.
    expect(renderKnob('gone', { displayOption: (option) => option, keepChosen: true }).textContent).toBe('gone');
  });
});
