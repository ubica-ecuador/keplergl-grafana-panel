import { LayerClasses } from '@kepler.gl/layers';

import { iconOf } from './keplerStore';

/**
 * Reading a stock layer's icon off its class.
 *
 * The flow field borrows the arc layer's icon, and kepler exports the raster
 * tile icon from its package index but not that one — the only other route is a
 * path into `dist/esm` that the next release is free to move. So it is read
 * from the prototype's getter, which is a documented member of every layer.
 *
 * That makes it worth pinning: if kepler ever stops exposing it, the layer
 * quietly falls back to the base class's placeholder and nobody notices until
 * they look at the panel.
 */
describe('iconOf', () => {
  it('finds the icon of a stock layer', () => {
    expect(iconOf(LayerClasses.arc)).toBeDefined();
  });

  it('finds a different icon for a different layer', () => {
    // Guards against reading something shared — a base-class placeholder, say —
    // and mistaking it for each layer's own.
    expect(iconOf(LayerClasses.arc)).not.toBe(iconOf(LayerClasses.point));
  });

  it('answers undefined rather than throwing for something that is not a layer', () => {
    expect(iconOf(undefined)).toBeUndefined();
    expect(iconOf({})).toBeUndefined();
  });
});
