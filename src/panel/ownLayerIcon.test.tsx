import React from 'react';
import { render } from '@testing-library/react';
import { registerEntry } from '@kepler.gl/actions';
import { LayerClasses, RasterTileIcon } from '@kepler.gl/layers';

import { KEPLER_INSTANCE_ID } from './constants';
import { createKeplerStore, iconOf } from './keplerStore';
import { OWN_LAYER_ICON_CLASS, OWN_LAYER_ICON_CSS, ownLayerIcon } from './ownLayerIcon';

type Icon = React.ComponentType<{ height?: string; className?: string; style?: React.CSSProperties }>;

const ArcLayerIcon = iconOf(LayerClasses.arc) as Icon;

/**
 * The layers this plugin adds show their icon in amber, so they can be told
 * from kepler's own in "Add Layer".
 *
 * The obvious way — kepler's icons take a `colors` prop — is the one that must
 * not be used: kepler's `Base` turns it into an `<svg><style>.cr1{fill:…}` whose
 * rules are not scoped to that icon, so one amber icon would paint every kepler
 * icon on the page amber too.
 */
describe('ownLayerIcon', () => {
  it('marks the icon with the class its tones are scoped to', () => {
    const Own = ownLayerIcon(ArcLayerIcon);
    const { container } = render(<Own height="16px" />);

    expect(container.querySelector('svg')?.getAttribute('class')).toContain(OWN_LAYER_ICON_CLASS);
  });

  it('never hands kepler a palette, whose rules would reach every icon', () => {
    const Own = ownLayerIcon(ArcLayerIcon);
    const { container } = render(<Own height="16px" />);

    // kepler's own <style> sits inside the <svg>; ours sits beside it.
    expect(container.querySelector('svg style')).toBeNull();
  });

  it('scopes every tone rule to the class', () => {
    const rules = OWN_LAYER_ICON_CSS.split('}').filter((rule) => rule.trim() !== '');

    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.trim().startsWith(`.${OWN_LAYER_ICON_CLASS} `)).toBe(true);
    }
  });

  it('colours a single-tone icon too, which paints with currentColor', () => {
    // The raster tile icon's paths say `fill="currentColor"` and carry no
    // `cr` class, so only `color` reaches them.
    const Own = ownLayerIcon(RasterTileIcon as Icon);
    const { container } = render(<Own height="16px" />);

    expect((container.querySelector('svg') as SVGSVGElement).style.color).not.toBe('');
  });

  it('leaves kepler’s own icon as kepler draws it', () => {
    const { container } = render(<ArcLayerIcon height="16px" />);

    expect(container.querySelector('svg')?.getAttribute('class')).not.toContain(OWN_LAYER_ICON_CLASS);
  });
});

describe('the layer registry', () => {
  /**
   * The icon a class shows, wherever along its prototype chain it is declared:
   * the WMS and 3D tile layers are kepler's own wrapped by a repair, and inherit
   * theirs.
   */
  const shownIcon = (LayerClass: unknown): unknown => {
    let prototype = (LayerClass as { prototype?: object } | undefined)?.prototype ?? null;
    while (prototype) {
      const getter = Object.getOwnPropertyDescriptor(prototype, 'layerIcon')?.get;
      if (getter) {
        return getter.call(prototype);
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return undefined;
  };

  it('gives every layer this plugin adds an amber icon, and no kepler layer one', () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }));
    const state = store.getState() as {
      keplerGl: Record<string, { visState: { layerClasses: Record<string, unknown> } }>;
    };
    const registry = state.keplerGl[KEPLER_INSTANCE_ID].visState.layerClasses;
    const own = ['flowfield', 'vectorfield', 'symbol', 'markers', 'zarr', 'cogPainted', 'esriImage'];

    for (const type of own) {
      expect((shownIcon(registry[type]) as { displayName?: string }).displayName).toMatch(/^OwnLayerIcon/);
    }
    for (const type of Object.keys(LayerClasses)) {
      expect(shownIcon(registry[type])).toBe(shownIcon((LayerClasses as Record<string, unknown>)[type]));
    }
  });
});
