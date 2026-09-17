import React from 'react';

/**
 * The class that marks the icon of a layer this plugin adds.
 *
 * In kepler's "Add Layer" menu the plugin's layers sit among kepler's own with
 * icons borrowed from them — the arc's for the streamlines, the icon layer's for
 * the vector field — and since 3.3.0-alpha.12 one of kepler's is a flow field as
 * well. Amber tells the two families apart at a glance.
 */
export const OWN_LAYER_ICON_CLASS = 'ubica-own-layer-icon';

/** Amber, lightest to deepest and back: kepler's multi-tone icons use up to six. */
export const OWN_LAYER_TONES = ['#FFD54F', '#FFB300', '#FF8F00', '#FFCA28', '#FFA000', '#FFC107'];

/**
 * One fill per tone class, scoped to the plugin's icons.
 *
 * kepler's icons take a `colors` prop, and that is exactly what must not be
 * used: its `Base` writes the palette as an `<svg><style>.cr1{fill:…}` whose
 * rules are not scoped to the icon that carries them, so one amber icon would
 * repaint every kepler icon on the page. Scoped here, the rules reach only
 * icons with the class — and outrank kepler's unscoped `.crN` if one is around.
 */
export const OWN_LAYER_ICON_CSS = OWN_LAYER_TONES.map(
  (tone, i) => `.${OWN_LAYER_ICON_CLASS} .cr${i + 1} { fill: ${tone}; }`
).join('\n');

interface IconProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A kepler layer icon, drawn in amber.
 *
 * `color` as well as the tone rules: kepler's raster tile icon has no tone
 * classes and paints with `currentColor`, so only `color` reaches it.
 */
export function ownLayerIcon<P extends IconProps>(Icon: React.ComponentType<P>): React.FC<P> {
  function OwnLayerIcon(props: P) {
    const className = props.className ? `${props.className} ${OWN_LAYER_ICON_CLASS}` : OWN_LAYER_ICON_CLASS;
    return (
      <>
        <style>{OWN_LAYER_ICON_CSS}</style>
        <Icon
          {...props}
          className={className}
          style={{ fill: 'currentColor', ...props.style, color: OWN_LAYER_TONES[1] }}
        />
      </>
    );
  }
  OwnLayerIcon.displayName = `OwnLayerIcon(${Icon.displayName ?? Icon.name ?? 'Icon'})`;
  return OwnLayerIcon;
}
