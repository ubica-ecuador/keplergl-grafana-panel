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

import { SelectKnob } from './selectKnob';
import { SymbolOption } from './symbolOption';

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

  return (
    <div>
      <LayerConfigGroup label={'symbol.group.symbol'} collapsible>
        {/* The shape's options are glyph names — the words a person reads, with
            no messages behind them — and there are several hundred, so the
            list is searched rather than scrolled. Each is drawn beside its
            name: `rail`, `rail-light` and `rail-metro` are words apart and
            shapes apart. */}
        <SelectKnob
          layer={layer}
          visConfiguratorProps={visConfiguratorProps}
          property="symbol"
          displayOption={(name) => name}
          searchable
          OptionComponent={SymbolOption}
        />
        <SelectKnob layer={layer} visConfiguratorProps={visConfiguratorProps} property="directionConvention" />
        <ConfigGroupCollapsibleContent>{slider('opacity')}</ConfigGroupCollapsibleContent>
      </LayerConfigGroup>

      <LayerConfigGroup label={'symbol.group.rotation'} collapsible>
        <ChannelByValueSelector channel={layer.visualChannels.angle} {...layerChannelConfigProps} />
        {/* No switch for `fixedAngle` here, on purpose, though the layer
            registers it and the size group offers its twin. It must stay on:
            off, kepler rescales the bearing onto a range this layer does not
            register and the layer stops drawing — and a bearing rescaled onto
            any range is a wrong bearing anyway. It is the one registered knob
            that deliberately has no control; do not add one. */}
        {layer.config.angleField ? null : slider('angleDegrees')}
      </LayerConfigGroup>

      <LayerConfigGroup label={'symbol.group.size'} collapsible>
        <ChannelByValueSelector channel={layer.visualChannels.size} {...layerChannelConfigProps} />
        {layer.config.sizeField ? (
          <>
            <VisConfigSwitch {...settings.fixedSize} {...visConfiguratorProps} />
            {slider('sizeRange')}
          </>
        ) : (
          slider('symbolSize')
        )}
        {settings.declutter ? (
          <>
            <VisConfigSwitch {...settings.declutter} {...visConfiguratorProps} />
            {layer.config.visConfig.declutter ? slider('declutterSpacingPx') : null}
          </>
        ) : null}
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
