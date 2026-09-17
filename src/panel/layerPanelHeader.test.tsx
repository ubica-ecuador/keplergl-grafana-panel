import React from 'react';
import { render } from '@testing-library/react';

import { headerLayerType, withOwnHeaderNames } from './layerPanelHeader';

/**
 * kepler's layer card names a layer's type from `layer.type.<type>`, lower-cased.
 * kepler's own `flowField` and this plugin's `flowfield` meet at the same id, so
 * whatever that message says, both cards would say it.
 */
describe('headerLayerType', () => {
  it('sends the flow field to its own name', () => {
    expect(headerLayerType('flowfield')).toBe('streamlines');
  });

  it('leaves kepler’s Flow Field where kepler looks', () => {
    expect(headerLayerType('flowField')).toBe('flowField');
  });

  it('passes every other type through, and nothing through as nothing', () => {
    expect(headerLayerType('point')).toBe('point');
    expect(headerLayerType('vectorfield')).toBe('vectorfield');
    expect(headerLayerType(null)).toBeNull();
    expect(headerLayerType(undefined)).toBeUndefined();
  });
});

describe('withOwnHeaderNames', () => {
  const StockHeader = ({ layerType, label }: { layerType?: string | null; label: string }) => (
    <div>
      {label}:{layerType}
    </div>
  );

  it('hands the stock header the id the flow field is named under', () => {
    const Header = withOwnHeaderNames(StockHeader);
    const { container } = render(<Header layerType="flowfield" label="wind" />);

    expect(container.textContent).toBe('wind:streamlines');
  });

  it('changes nothing else it is handed', () => {
    const Header = withOwnHeaderNames(StockHeader);
    const { container } = render(<Header layerType="flowField" label="kepler" />);

    expect(container.textContent).toBe('kepler:flowField');
  });
});
