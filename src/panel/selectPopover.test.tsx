import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';

import { KEPLER_INSTANCE_ID } from './constants';
import { offersSelection, selectApi, SelectContext, withSelectButton, type SelectApi } from './selectPopover';
import type { VariableMapping } from './variableSync';

/**
 * The button the panel adds to kepler's popup when it asks the user to confirm.
 *
 * Tested against a stand-in for kepler's own popup content — the real one needs
 * a theme and an intl provider, and what matters here is when the button shows
 * and which of the two things it does. `keplerRecipes.test.ts` proves the real
 * component is the one being wrapped.
 */

const StockContent = () => <div>the entity’s fields</div>;

/** The panel's store, as far as the popup is concerned: is anything pinned? */
function makeStore(clicked: unknown) {
  return {
    getState: () => ({ keplerGl: { [KEPLER_INSTANCE_ID]: { visState: { clicked } } } }),
    subscribe: () => () => undefined,
    dispatch: (action: unknown) => action,
  };
}

const pinned = { index: 0 };

function mount(clicked: unknown, api: SelectApi | null) {
  const Content = withSelectButton(StockContent);
  return render(
    <Provider store={makeStore(clicked) as never}>
      <SelectContext.Provider value={api}>
        <Content />
      </SelectContext.Provider>
    </Provider>
  );
}

const api = (over: Partial<SelectApi> = {}): SelectApi => ({
  armed: true,
  isSelected: () => false,
  select: jest.fn(),
  clear: jest.fn(),
  ...over,
});

describe('offersSelection', () => {
  const click: VariableMapping = { field: 'site', variable: 'site', source: 'click' };
  const filter: VariableMapping = { field: 'category', variable: 'category' };

  it('asks for confirmation when the panel publishes a clicked entity', () => {
    expect(offersSelection({ confirm: true, mappings: [click], clickArea: false })).toBe(true);
  });

  it('asks for confirmation when the click places the search square', () => {
    expect(offersSelection({ confirm: true, mappings: [], clickArea: true })).toBe(true);
  });

  it('never asks in a panel that publishes on the click itself', () => {
    expect(offersSelection({ confirm: false, mappings: [click], clickArea: true })).toBe(false);
  });

  it('offers no button where a click selects nothing', () => {
    // Confirm mode on a panel whose only mapping is an ordinary filter: there
    // would be nothing for the button to do.
    expect(offersSelection({ confirm: true, mappings: [filter], clickArea: false })).toBe(false);
  });
});

describe('selectApi', () => {
  /** Records the order, which is the point: both writers read what is clicked. */
  function parts() {
    const order: string[] = [];
    return {
      order,
      variables: { select: () => order.push('publish'), clear: () => order.push('clear'), isSelected: () => true },
      area: { select: () => order.push('square') },
      close: () => order.push('close'),
    };
  }

  it('publishes and places the square before it closes the popup', () => {
    // Closing clears kepler's clicked entity, which is where both of them read
    // the selection from: close first and the button would do nothing.
    const { order, variables, area, close } = parts();

    selectApi({ armed: true, variables, area, close }).select();

    expect(order).toEqual(['publish', 'square', 'close']);
  });

  it('closes the popup after clearing too', () => {
    const { order, variables, area, close } = parts();

    selectApi({ armed: true, variables, area, close }).clear();

    expect(order).toEqual(['clear', 'close']);
  });

  it('reports the selection the variables hold', () => {
    const { variables, area, close } = parts();

    expect(selectApi({ armed: true, variables, area, close }).isSelected()).toBe(true);
  });
});

it('always shows kepler’s own popup content', () => {
  mount(pinned, api());

  expect(screen.getByText('the entity’s fields')).toBeInTheDocument();
});

it('offers Select on the pinned popup of an entity that is not the selection', () => {
  mount(pinned, api());

  expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
});

it('publishes the entity when Select is pressed', () => {
  const select = jest.fn();
  mount(pinned, api({ select }));

  screen.getByRole('button', { name: 'Select' }).click();

  expect(select).toHaveBeenCalledTimes(1);
});

it('offers Clear selection on the entity the variables already hold', () => {
  mount(pinned, api({ isSelected: () => true }));

  expect(screen.getByRole('button', { name: 'Clear selection' })).toBeInTheDocument();
});

it('clears the selection when Clear is pressed', () => {
  const clear = jest.fn();
  mount(pinned, api({ isSelected: () => true, clear }));

  screen.getByRole('button', { name: 'Clear selection' }).click();

  expect(clear).toHaveBeenCalledTimes(1);
});

it('stays out of the popup that merely follows the pointer', () => {
  // Nothing is pinned: this is the hover popup, and hovering selects nothing.
  mount(null, api());

  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('stays out of a panel that publishes on the click itself', () => {
  mount(pinned, api({ armed: false }));

  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('stays out of a panel that has no selection to make', () => {
  mount(pinned, null);

  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
