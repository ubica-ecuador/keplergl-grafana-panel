import React from 'react';
// Deep imports on purpose: the context must be the very module instance the
// original Portaled consumes, and importing the barrel here would make the
// module replacement below circular (the barrel itself requires portaled).
import { RootContext } from '@kepler.gl/components/dist/context';
// The unpatched component; every request for this module from inside
// @kepler.gl is rewritten to this file by the NormalModuleReplacementPlugin
// in webpack.config.ts.
import KeplerPortaled from '@kepler.gl/components/dist/common/portaled';

/**
 * kepler's Portaled renders every dropdown, color picker and tooltip through
 * a react-modal parented to RootContext — KeplerGl's own root div — and
 * positions its content with `position: fixed` at viewport coordinates.
 *
 * Inside a Grafana dashboard that root div lives under `.react-grid-item`,
 * whose CSS transform makes the grid item (not the viewport) the containing
 * block for fixed descendants, and under panel chrome that clips overflow. So
 * every dropdown opened from the side panel rendered shifted down by the
 * panel's viewport offset and was cut off at the panel's edge — near the
 * bottom of a panel the options never appeared at all.
 *
 * A ref that never resolves makes Portaled's react-modal fall back to
 * `document.body`, which has no transformed or clipping ancestors: kepler's
 * viewport coordinates land where they were computed and the list can extend
 * past the panel like any ordinary dropdown. Styling is unaffected — the
 * panel-scoped <style> tags styled-components writes apply document-wide,
 * and the theme travels through React context, which crosses portals.
 */
const DETACHED_ROOT: React.RefObject<HTMLDivElement> = { current: null };

type PortaledProps = React.ComponentProps<typeof KeplerPortaled>;

export default function PortaledBodyMount(props: PortaledProps) {
  return (
    <RootContext.Provider value={DETACHED_ROOT}>
      <KeplerPortaled {...props} />
    </RootContext.Provider>
  );
}
