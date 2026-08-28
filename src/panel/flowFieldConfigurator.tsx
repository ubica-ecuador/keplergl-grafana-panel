import React from 'react';
import {
  ConfigGroupCollapsibleContent,
  LayerColorRangeSelector,
  LayerColorSelector,
  LayerConfigGroup,
  LayerConfiguratorFactory,
  VisConfigSlider,
  VisConfigSwitch,
} from '@kepler.gl/components';

/**
 * The layer panel for the flow field.
 *
 * kepler picks a layer's configurator by name: `LayerConfigurator.render` looks
 * for a method called `_render${Type}LayerConfig` on itself and calls it with
 * the layer and the change handlers. A type it has never heard of finds none,
 * and gets the "basic" group alone — a type selector and a data source, with
 * every knob the layer registered unreachable. That is what the Zarr layer
 * still looks like today.
 *
 * So the stock configurator is subclassed to grow the one method, and the
 * subclass swapped in through `injectComponents` — the same door the effects
 * map control and the range brush already come through.
 */

type Factory = typeof LayerConfiguratorFactory;

/** What kepler hands a `_render…LayerConfig` method. */
interface ConfiguratorArgs {
  layer: {
    config: { visConfig: Record<string, unknown> };
    /** Each entry is the slider/switch definition the layer registered. */
    visConfigSettings: Record<string, Record<string, unknown>>;
  };
  visConfiguratorProps: Record<string, unknown>;
  layerConfiguratorProps: Record<string, unknown>;
}

function FlowFieldLayerConfig({ layer, visConfiguratorProps, layerConfiguratorProps }: ConfiguratorArgs) {
  const settings = layer.visConfigSettings;
  const bySpeed = layer.config.visConfig.colorBySpeed !== false;

  /** Every slider is spread the same way; kepler's own configurators do this inline. */
  const slider = (key: string) => <VisConfigSlider {...settings[key]} {...visConfiguratorProps} />;

  return (
    <div>
      <LayerConfigGroup label={'layer.color'} collapsible>
        {/* A field's colour is its speed, not a column: the rows are a lattice
            of samples and the lines are traced through them, so there is no row
            to read a value from. Hence a ramp of our own rather than kepler's
            channel selector. */}
        <VisConfigSwitch {...settings.colorBySpeed} {...visConfiguratorProps} />
        {bySpeed ? (
          <LayerColorRangeSelector {...visConfiguratorProps} />
        ) : (
          <LayerColorSelector {...layerConfiguratorProps} />
        )}
        <ConfigGroupCollapsibleContent>{slider('opacity')}</ConfigGroupCollapsibleContent>
      </LayerConfigGroup>

      {/* Density, width and trail are the three the field is actually shaped
          with, so none of them sits behind the group's expander. The trail
          especially: it is the difference between drifting particles and a
          classic wind chart, which is not a choice to hide one click away. */}
      <LayerConfigGroup label={'flowfield.group.streamlines'} collapsible>
        {slider('density')}
        {slider('thickness')}
        {slider('trailShare')}
        <ConfigGroupCollapsibleContent>{slider('lineLength')}</ConfigGroupCollapsibleContent>
      </LayerConfigGroup>

      {/* The lifetime is out in the open now that the seamless loop is what
          decides the pulsing: with it on, the lifetime says only how much of the
          field is lit at once, which is a thing worth reaching for. */}
      <LayerConfigGroup label={'flowfield.group.animation'} collapsible>
        {slider('cycleSeconds')}
        {slider('lifeFraction')}
        <VisConfigSwitch {...settings.seamlessLoop} {...visConfiguratorProps} />
      </LayerConfigGroup>

      {/* Both height knobs are in plain sight, and they are not two spellings of
          the same thing. The metres say what this level *is*, which only counts
          against the other levels on the map; the exaggeration says how tall the
          stack is drawn, and is the one that moves a lone layer. Hiding either
          would leave the other looking broken. */}
      <LayerConfigGroup label={'flowfield.group.field'} collapsible>
        {slider('smoothing')}
        {slider('heightMeters')}
        {slider('elevationScale')}
      </LayerConfigGroup>
    </div>
  );
}

CustomLayerConfiguratorFactory.deps = LayerConfiguratorFactory.deps;

function CustomLayerConfiguratorFactory(...deps: Parameters<typeof LayerConfiguratorFactory>) {
  const LayerConfigurator = LayerConfiguratorFactory(...deps) as unknown as new (
    props: unknown
  ) => React.Component;

  class LayerConfiguratorWithFlowField extends LayerConfigurator {
    // Named for kepler's lookup, not for us: `_render` + the capitalised layer
    // type + `LayerConfig`. Rename the layer type and this must follow.
    _renderFlowfieldLayerConfig(args: ConfiguratorArgs) {
      return <FlowFieldLayerConfig {...args} />;
    }
  }

  return LayerConfiguratorWithFlowField;
}

/** The recipe `injectComponents` expects to swap the stock layer configurator. */
export function replaceLayerConfigurator(): [Factory, Factory] {
  return [LayerConfiguratorFactory, CustomLayerConfiguratorFactory as unknown as Factory];
}
