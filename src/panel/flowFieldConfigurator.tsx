import React from 'react';
import { useIntl } from 'react-intl';
import {
  ConfigGroupCollapsibleContent,
  ItemSelector,
  LayerColorRangeSelector,
  LayerColorSelector,
  LayerConfigGroup,
  LayerConfiguratorFactory,
  PanelLabel,
  SidePanelSection,
  VisConfigSlider,
  VisConfigSwitch,
} from '@kepler.gl/components';

import { PaintedTilesetConfig } from './paintedTilesetConfigurator';
import { Tile3dLayerConfig } from './tile3dConfigurator';

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
    config: { visConfig: Record<string, unknown>; columnMode?: string };
    /** Each entry is the slider/switch definition the layer registered. */
    visConfigSettings: Record<string, Record<string, unknown>>;
    /** What the layer learnt from tracing — see `formatLayerData`. */
    meta?: { speedDomain?: [number, number] };
  };
  visConfiguratorProps: Record<string, unknown>;
  layerConfiguratorProps: Record<string, unknown>;
}

/**
 * Which way the gradient is read as a flow.
 *
 * A choice among words rather than a number, so none of kepler's sliders fit;
 * `ItemSelector` is what it uses for its own `select` knobs. Both the label and
 * the three values go through react-intl, because a selector showing
 * `downhill` is the same failure as a label reading "Flowfield.Density" — the
 * key reaching the screen because nothing translated it.
 *
 * Absent outside the gradient mode: u and v already say which way the air
 * goes, and a knob that does nothing is worse than no knob.
 */
function GradientDirection({ layer, visConfiguratorProps }: Omit<ConfiguratorArgs, 'layerConfiguratorProps'>) {
  const intl = useIntl();
  const setting = layer.visConfigSettings.gradientDirection as { options?: string[] } | undefined;

  if (layer.config.columnMode !== 'gradient' || !setting?.options) {
    return null;
  }

  const onChange = visConfiguratorProps.onChange as (patch: Record<string, unknown>) => void;

  return (
    <SidePanelSection>
      <PanelLabel>{intl.formatMessage({ id: 'flowfield.gradientDirection' })}</PanelLabel>
      <ItemSelector
        selectedItems={(layer.config.visConfig.gradientDirection as string) ?? 'downhill'}
        options={setting.options}
        multiSelect={false}
        searchable={false}
        getOptionValue={(option: string) => option}
        displayOption={(option: string) =>
          intl.formatMessage({ id: `flowfield.gradientDirection.${option}` })
        }
        // `ItemSelector` types its handler for the multi-select case too, so
        // the value arrives as the union of everything it can hand back. Ours
        // is single-select over strings; anything else is not an answer.
        onChange={(value) => {
          if (typeof value === 'string') {
            onChange({ gradientDirection: value });
          }
        }}
      />
    </SidePanelSection>
  );
}

/**
 * How far the range slider reaches, and how finely it moves.
 *
 * Twice the field's fastest cell, rounded up to a 1, 2 or 5, so a range can be
 * set a little above the field for comparing it with a windier one — and past
 * that, kepler's own number boxes take over. The step is a five-hundredth of
 * that, because the same slider serves a wind of tens of metres a second and a
 * slope of a few hundredths: a wind-sized step on a slope leaves the thumb two
 * places to be.
 */
export function speedRangeBounds(domain: [number, number]): { range: [number, number]; step: number } {
  const target = Math.max(domain[1], 0) * 2;
  if (!(target > 0)) {
    return { range: [0, 1], step: 0.002 };
  }
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const top = [1, 2, 5, 10].find((m) => m * magnitude >= target)! * magnitude;
  return { range: [0, top], step: top / 500 };
}

/**
 * A range rounded outwards to a step, and printed without floating-point noise.
 *
 * Outwards so the slowest and fastest lines stay inside it. The quotient is
 * tidied before it is floored or ceiled: a division that should land on a
 * whole number of steps can come out a hair above it, and the ceiling of that
 * would widen the range by a whole step for nothing.
 */
function roundedOutwards([min, max]: [number, number], step: number): [number, number] {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const steps = (value: number) => Number((value / step).toPrecision(12));
  return [
    Number((Math.floor(steps(min)) * step).toFixed(decimals)),
    Number((Math.ceil(steps(max)) * step).toFixed(decimals)),
  ];
}

/**
 * The switch that fixes the colour ramp's range, and the range it fixes.
 *
 * The switch is kepler's, with its change widened by one thing: the first time
 * it is turned on, the range starts at the field's own. The layer registers no
 * default range because no number suits both a wind and a slope, so without
 * this the slider would open on nothing at all.
 */
function FixedSpeedRange({ layer, visConfiguratorProps }: Omit<ConfiguratorArgs, 'layerConfiguratorProps'>) {
  const settings = layer.visConfigSettings;
  const visConfig = layer.config.visConfig;
  const onChange = visConfiguratorProps.onChange as (patch: Record<string, unknown>) => void;
  const fieldDomain = layer.meta?.speedDomain;
  const chosen = Array.isArray(visConfig.speedRange) ? (visConfig.speedRange as [number, number]) : null;

  const toggle = (patch: Record<string, unknown>) =>
    onChange(
      patch.fixedSpeedRange === true && !chosen && fieldDomain
        ? { ...patch, speedRange: roundedOutwards(fieldDomain, speedRangeBounds(fieldDomain).step) }
        : patch
    );

  return (
    <>
      <VisConfigSwitch {...settings.fixedSpeedRange} {...visConfiguratorProps} onChange={toggle} />
      {visConfig.fixedSpeedRange === true && chosen ? (
        <VisConfigSlider
          {...settings.speedRange}
          {...visConfiguratorProps}
          {...speedRangeBounds(fieldDomain ?? chosen)}
        />
      ) : null}
    </>
  );
}

function FlowFieldLayerConfig({ layer, visConfiguratorProps, layerConfiguratorProps }: ConfiguratorArgs) {
  const settings = layer.visConfigSettings;
  const bySpeed = layer.config.visConfig.colorBySpeed !== false;
  const widthBySpeed = layer.config.visConfig.widthBySpeed === true;
  const opacityBySpeed = layer.config.visConfig.opacityBySpeed === true;

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
        <VisConfigSwitch {...settings.opacityBySpeed} {...visConfiguratorProps} />
        {opacityBySpeed ? slider('calmOpacity') : null}
        {/* The range is what colour, width and opacity are all measured against,
            so it stays while any of them follows speed — not only the colour. */}
        {bySpeed || widthBySpeed || opacityBySpeed ? (
          <FixedSpeedRange layer={layer} visConfiguratorProps={visConfiguratorProps} />
        ) : null}
        <ConfigGroupCollapsibleContent>{slider('opacity')}</ConfigGroupCollapsibleContent>
      </LayerConfigGroup>

      {/* Density, width and trail are the three the field is actually shaped
          with, so none of them sits behind the group's expander. The trail
          especially: it is the difference between drifting particles and a
          classic wind chart, which is not a choice to hide one click away. */}
      <LayerConfigGroup label={'flowfield.group.streamlines'} collapsible>
        {slider('density')}
        {slider('zoomResponse')}
        <VisConfigSwitch {...settings.widthBySpeed} {...visConfiguratorProps} />
        {widthBySpeed ? slider('widthRange') : slider('thickness')}
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
        <GradientDirection layer={layer} visConfiguratorProps={visConfiguratorProps} />
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

    // The three layers whose picture arrives already drawn share one panel —
    // see `paintedTilesetConfigurator.tsx`. Same naming rule as above, and
    // `paintedTilesetConfigurator.test.tsx` derives these names from the layer
    // types so a rename fails a test rather than emptying a panel in silence.
    _renderCogPaintedLayerConfig(args: ConfiguratorArgs) {
      return <PaintedTilesetConfig {...args} />;
    }

    _renderEsriImageLayerConfig(args: ConfiguratorArgs) {
      return <PaintedTilesetConfig {...args} />;
    }

    _renderZarrLayerConfig(args: ConfiguratorArgs) {
      return <PaintedTilesetConfig {...args} />;
    }

    // The one layer here that kepler does ship a panel for. Overridden rather
    // than left alone because the two knobs `tile3dAltitudeLayer.ts` registers
    // would otherwise be unreachable — and one of them is the difference
    // between a mesh that draws and one that silently does not.
    _renderTile3dLayerConfig(args: ConfiguratorArgs) {
      return <Tile3dLayerConfig {...args} />;
    }
  }

  return LayerConfiguratorWithFlowField;
}

/** The recipe `injectComponents` expects to swap the stock layer configurator. */
export function replaceLayerConfigurator(): [Factory, Factory] {
  return [LayerConfiguratorFactory, CustomLayerConfiguratorFactory as unknown as Factory];
}
