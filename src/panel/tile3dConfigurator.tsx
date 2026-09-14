import React from 'react';
import { LayerColorSelector, LayerConfigGroup, VisConfigSlider, VisConfigSwitch } from '@kepler.gl/components';

/**
 * The layer panel for a 3D tileset.
 *
 * kepler ships one of these already — colour, opacity and point size — and this
 * reproduces it rather than extending it, because the two knobs this plugin
 * adds want a group of their own and kepler's method returns one finished
 * element with nowhere to append.
 *
 * The new group is *Position*, and it exists because a 3D tileset states its
 * geometry at its real altitude while the panel's world is flat. See
 * `tile3dAltitude.ts` for what that costs — briefly: an ungrounded mesh is not
 * merely misplaced, it vanishes from any close or tilted camera, with no error
 * anywhere. Both knobs are in plain sight rather than behind the group's
 * expander for that reason: when they are the difference between a picture and
 * a blank map, one click away is one click too many.
 *
 * Wired in `flowFieldConfigurator.tsx`, which already owns the configurator
 * subclass kepler is handed.
 */

/** What kepler hands a `_render…LayerConfig` method, narrowed to what is used. */
export interface Tile3dLayerConfigProps {
  layer: {
    /** Each entry is the slider/switch definition the layer registered. */
    visConfigSettings: Record<string, Record<string, unknown>>;
  };
  visConfiguratorProps: Record<string, unknown>;
  layerConfiguratorProps: Record<string, unknown>;
}

export function Tile3dLayerConfig({ layer, visConfiguratorProps, layerConfiguratorProps }: Tile3dLayerConfigProps) {
  const settings = layer?.visConfigSettings ?? {};

  /** Absent rather than broken: a layer mid-construction has registered nothing. */
  const slider = (key: string) =>
    settings[key] ? <VisConfigSlider {...settings[key]} {...visConfiguratorProps} /> : null;

  return (
    <div>
      {/* kepler's own group, kept as it stands so nothing regresses for the
          tilesets that already drew correctly. */}
      <LayerConfigGroup label={'layer.appearance'}>
        <LayerColorSelector {...layerConfiguratorProps} />
        {slider('opacity')}
        {slider('pointSize')}
      </LayerConfigGroup>

      <LayerConfigGroup label={'tile3d.group.position'}>
        {settings.groundTileset ? <VisConfigSwitch {...settings.groundTileset} {...visConfiguratorProps} /> : null}
        {slider('altitudeOffset')}
      </LayerConfigGroup>
    </div>
  );
}
