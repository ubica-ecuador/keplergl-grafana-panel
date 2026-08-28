import React from 'react';
import { ConfigGroupCollapsibleContent, LayerConfigGroup, VisConfigSlider } from '@kepler.gl/components';

/**
 * The layer panel for a tileset whose picture arrives already drawn.
 *
 * Three of this plugin's layers are in that position — a painted COG, an ArcGIS
 * Image Service and a Zarr variable — and all three have the same, very short,
 * list of things a user can still change. The colours were decided before the
 * image was sent: by the palette inside the file, by the service's own
 * renderer, or by the colormap the tile request named. What is left is how
 * strongly it sits over the base map.
 *
 * Small as that is, it is the difference between a layer you can blend and one
 * you can only switch off. kepler renders a layer's settings from a method
 * called `_render${Type}LayerConfig` on its configurator and ships none for a
 * type a plugin contributes, so without this the panel shows the layer, its
 * data source, and nothing else — with every setting the layer registered
 * sitting there unreachable.
 *
 * Wired in `flowFieldConfigurator.tsx`, which already owns the subclass kepler
 * is handed.
 */

/** What kepler hands a `_render…LayerConfig` method, narrowed to what is used. */
export interface PaintedTilesetConfigProps {
  layer: {
    /** Each entry is the slider definition the layer registered. */
    visConfigSettings: Record<string, Record<string, unknown>>;
  };
  visConfiguratorProps: Record<string, unknown>;
}

export function PaintedTilesetConfig({ layer, visConfiguratorProps }: PaintedTilesetConfigProps) {
  const opacity = layer?.visConfigSettings?.opacity;

  return (
    <div>
      <LayerConfigGroup label={'layer.color'} collapsible>
        {/* Not behind the expander. It is the only control there is, and one
            click away from an otherwise empty group reads as a bug. */}
        {opacity ? <VisConfigSlider {...opacity} {...visConfiguratorProps} /> : null}
        {/* The group still wants collapsible content or it renders its expander
            over nothing. */}
        <ConfigGroupCollapsibleContent />
      </LayerConfigGroup>
    </div>
  );
}
