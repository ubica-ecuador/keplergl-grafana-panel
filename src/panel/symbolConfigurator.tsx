import React from 'react';
import {
  ChannelByValueSelector,
  ConfigGroupCollapsibleContent,
  LayerColorRangeSelector,
  LayerColorSelector,
  LayerConfigGroup,
  VisConfigSlider,
  VisConfigSwitch,
} from '@kepler.gl/components';

import { SelectKnob } from './flowFieldConfigurator';

/**
 * The layer panel for the symbol layer.
 *
 * Four groups, and what each offers follows what is drawn: the fixed angle only
 * where no column turns the symbols, the size range only where a column sizes
 * them. kepler hands this method `layerChannelConfigProps`, which is what makes
 * a column picker one line rather than a pile of wiring.
 */
interface ConfiguratorArgs {
  layer: {
    config: { visConfig: Record<string, unknown>; angleField?: unknown; sizeField?: unknown; colorField?: unknown };
    visConfigSettings: Record<string, Record<string, unknown>>;
    visualChannels: Record<string, unknown>;
  };
  visConfiguratorProps: Record<string, unknown>;
  layerConfiguratorProps: Record<string, unknown>;
  layerChannelConfigProps: Record<string, unknown>;
}

export function SymbolLayerConfig({
  layer,
  visConfiguratorProps,
  layerConfiguratorProps,
  layerChannelConfigProps,
}: ConfiguratorArgs) {
  const settings = layer.visConfigSettings;
  const slider = (key: string) => <VisConfigSlider {...settings[key]} {...visConfiguratorProps} />;
  const select = (property: string) => (
    <SelectKnob layer={layer as never} visConfiguratorProps={visConfiguratorProps} property={property} />
  );

  return (
    <div>
      <LayerConfigGroup label={'symbol.group.symbol'} collapsible>
        {select('symbol')}
        {select('directionConvention')}
        <ConfigGroupCollapsibleContent>{slider('opacity')}</ConfigGroupCollapsibleContent>
      </LayerConfigGroup>

      <LayerConfigGroup label={'symbol.group.rotation'} collapsible>
        <ChannelByValueSelector channel={layer.visualChannels.angle} {...layerChannelConfigProps} />
        {layer.config.angleField ? (
          <VisConfigSwitch {...settings.fixedAngle} {...visConfiguratorProps} />
        ) : (
          slider('angleDegrees')
        )}
      </LayerConfigGroup>

      <LayerConfigGroup label={'symbol.group.size'} collapsible>
        <ChannelByValueSelector channel={layer.visualChannels.size} {...layerChannelConfigProps} />
        {layer.config.sizeField ? slider('sizeRange') : slider('symbolSize')}
      </LayerConfigGroup>

      <LayerConfigGroup label={'layer.color'} collapsible>
        <ChannelByValueSelector channel={layer.visualChannels.color} {...layerChannelConfigProps} />
        {layer.config.colorField ? (
          <LayerColorRangeSelector {...visConfiguratorProps} />
        ) : (
          <LayerColorSelector {...layerConfiguratorProps} />
        )}
      </LayerConfigGroup>
    </div>
  );
}
