import React from 'react';
import { LayerConfigGroup, VisConfigSlider, VisConfigSwitch } from '@kepler.gl/components';

import { SelectKnob } from './selectKnob';

/** What kepler hands a `_render…LayerConfig` method, as much of it as the grid group reads. */
export interface CellsConfiguratorArgs {
  layer: {
    id: string;
    config: { visConfig: Record<string, unknown> };
    visConfigSettings: Record<string, Record<string, unknown>>;
  };
  visConfiguratorProps: Record<string, unknown>;
}

/**
 * The Cells layer's own group: which grid, per km² and the transition. The rest of its panel is kepler's aggregation
 * panel, the Hexbin's (colour, the Radius group whose slider is the cell size here, height, count labels), which the
 * layer configurator draws after this group (`flowFieldConfigurator.tsx`).
 */
export function CellsGridGroup({ layer, visConfiguratorProps }: CellsConfiguratorArgs) {
  const settings = layer.visConfigSettings as Record<string, any>;
  return (
    <LayerConfigGroup label={'cells.grid'}>
      <SelectKnob layer={layer} visConfiguratorProps={visConfiguratorProps} property="cellSystem" />
      <VisConfigSwitch {...settings.cellDensity} {...visConfiguratorProps} />
      <VisConfigSlider {...settings.cellTransition} {...visConfiguratorProps} />
    </LayerConfigGroup>
  );
}
