import React from 'react';
import { ConfigGroupCollapsibleContent, LayerConfigGroup, VisConfigSlider } from '@kepler.gl/components';

import { SelectKnob } from './selectKnob';

/**
 * The layer panel for the photos layer (`photosLayer.ts`): which column holds
 * the pictures, their size, the frame's shape and width, and the opacity.
 * The frame's colour is the layer's colour, at the top of the panel as for any
 * layer. Wired in `flowFieldConfigurator.tsx` like the plugin's other panels.
 */
export interface PhotosLayerConfigProps {
  layer: {
    id?: string;
    config: { visConfig: Record<string, unknown> };
    visConfigSettings: Record<string, Record<string, unknown>>;
  };
  dataset?: { fields?: Array<{ name: string; type?: string }> };
  visConfiguratorProps: Record<string, unknown>;
}

export function PhotosLayerConfig({ layer, dataset, visConfiguratorProps }: PhotosLayerConfigProps) {
  const settings = layer.visConfigSettings;
  // The pictures are addresses: the text columns are the candidates.
  const columns = (dataset?.fields ?? []).filter((f) => f.type === 'string').map((f) => f.name);
  const slider = (key: string) =>
    settings[key] ? <VisConfigSlider {...settings[key]} {...visConfiguratorProps} /> : null;

  return (
    <div>
      <LayerConfigGroup label={'photos.photoField'} collapsible={false}>
        <SelectKnob
          layer={layer}
          visConfiguratorProps={visConfiguratorProps}
          property="photoField"
          options={columns}
          displayOption={(name) => name}
          keepChosen
        />
      </LayerConfigGroup>
      <LayerConfigGroup label={'layer.color'} collapsible>
        {slider('opacity')}
        {slider('photoSize')}
        <SelectKnob layer={layer} visConfiguratorProps={visConfiguratorProps} property="photoKind" />
        {slider('photoBorder')}
        <ConfigGroupCollapsibleContent />
      </LayerConfigGroup>
    </div>
  );
}
