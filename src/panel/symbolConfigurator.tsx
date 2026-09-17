import React, { ComponentType } from 'react';
import {
  ChannelByValueSelector,
  ConfigGroupCollapsibleContent,
  LayerColorRangeSelector,
  LayerColorSelector,
  LayerConfigGroup,
  VisConfigSlider,
  VisConfigSwitch,
} from '@kepler.gl/components';

import { PictureSourceInput } from './pictureSourceInput';
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
/**
 * The change the Draw selector writes. Choosing pictures stands them upright in
 * the same change: a photo or a logo lying flat reads badly under a pitched
 * camera. Only on the way in from shapes, so a user who laid their pictures
 * down is not overruled by choosing pictures again.
 */
export function sourcePatch(patch: Record<string, unknown>, currentSource: unknown): Record<string, unknown> {
  return patch.symbolSource === 'picture' && currentSource !== 'picture' ? { ...patch, upright: true } : patch;
}

interface ConfiguratorArgs {
  layer: {
    id?: string;
    config: {
      visConfig: Record<string, unknown>;
      angleField?: unknown;
      sizeField?: unknown;
      colorField?: unknown;
      textLabel?: unknown;
    };
    visConfigSettings: Record<string, Record<string, unknown>>;
    visualChannels: Record<string, unknown>;
  };
  visConfiguratorProps: Record<string, unknown>;
  layerConfiguratorProps: Record<string, unknown>;
  layerChannelConfigProps: Record<string, unknown>;
  /** kepler's text label panel, from the configurator's dependencies. */
  TextLabelPanel?: ComponentType<Record<string, unknown>>;
  /** The action that edits one of the layer's labels. */
  updateLayerTextLabel?: unknown;
}

export function SymbolLayerConfig({
  layer,
  visConfiguratorProps,
  layerConfiguratorProps,
  layerChannelConfigProps,
  TextLabelPanel,
  updateLayerTextLabel,
}: ConfiguratorArgs) {
  const settings = layer.visConfigSettings;
  const slider = (key: string) => <VisConfigSlider {...settings[key]} {...visConfiguratorProps} />;

  const visConfig = layer.config.visConfig;
  const picture = visConfig.symbolSource === 'picture';
  const onVisConfigChange = visConfiguratorProps.onChange as (patch: Record<string, unknown>) => void;
  const sourceProps = {
    ...visConfiguratorProps,
    onChange: (patch: Record<string, unknown>) => onVisConfigChange(sourcePatch(patch, visConfig.symbolSource)),
  };

  return (
    <div>
      <LayerConfigGroup label={'symbol.group.symbol'} collapsible>
        <SelectKnob layer={layer} visConfiguratorProps={sourceProps} property="symbolSource" />
        {picture ? (
          <>
            <PictureSourceInput
              layer={layer}
              value={typeof visConfig.pictureUrl === 'string' ? visConfig.pictureUrl : ''}
              onChange={(url) => onVisConfigChange({ pictureUrl: url })}
            />
            <SelectKnob layer={layer} visConfiguratorProps={visConfiguratorProps} property="pictureAnchor" />
          </>
        ) : (
          // The shape's options are glyph names — the words a person reads,
          // with no messages behind them — and there are several hundred, so
          // the list is searched rather than scrolled. Each is drawn beside its
          // name: `rail`, `rail-light` and `rail-metro` are words apart and
          // shapes apart.
          <SelectKnob
            layer={layer}
            visConfiguratorProps={visConfiguratorProps}
            property="symbol"
            displayOption={(name) => name}
            searchable
            OptionComponent={SymbolOption}
          />
        )}
        <SelectKnob layer={layer} visConfiguratorProps={visConfiguratorProps} property="directionConvention" />
        {settings.upright ? <VisConfigSwitch {...settings.upright} {...visConfiguratorProps} /> : null}
        <ConfigGroupCollapsibleContent>{slider('opacity')}</ConfigGroupCollapsibleContent>
      </LayerConfigGroup>

      {/* Outline and shadow are groups switched from their header, the way
          kepler's point layer offers its outline: off, the controls stay in
          view but disabled. A picture has neither: both are cut from the
          glyph atlas, and a picture's atlas is deck's. */}
      {!picture && settings.outline ? (
        <LayerConfigGroup {...settings.outline} {...visConfiguratorProps} collapsible>
          <LayerColorSelector
            {...visConfiguratorProps}
            selectedColor={layer.config.visConfig.outlineColor}
            property="outlineColor"
          />
          {slider('outlineThickness')}
        </LayerConfigGroup>
      ) : null}

      {!picture && settings.shadow ? (
        <LayerConfigGroup {...settings.shadow} {...visConfiguratorProps} collapsible>
          {slider('shadowOpacity')}
          {slider('shadowDistance')}
        </LayerConfigGroup>
      ) : null}

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

      {/* A picture keeps its own colours: deck ignores the colour of an icon
          that is not a mask. */}
      {picture ? null : (
        <LayerConfigGroup label={'layer.color'} collapsible>
          <ChannelByValueSelector channel={layer.visualChannels.color} {...layerChannelConfigProps} />
          {layer.config.colorField ? (
            <LayerColorRangeSelector {...visConfiguratorProps} />
          ) : (
            <LayerColorSelector {...layerConfiguratorProps} />
          )}
          {settings.gradient ? (
            <>
              <VisConfigSwitch {...settings.gradient} {...visConfiguratorProps} />
              {layer.config.visConfig.gradient ? slider('gradientTail') : null}
            </>
          ) : null}
        </LayerConfigGroup>
      )}

      {TextLabelPanel ? (
        <TextLabelPanel
          id={layer.id}
          fields={visConfiguratorProps.fields}
          updateLayerTextLabel={updateLayerTextLabel}
          textLabel={layer.config.textLabel}
        />
      ) : null}
    </div>
  );
}
