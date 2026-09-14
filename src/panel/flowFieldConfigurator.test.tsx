import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { LAYER_VIS_CONFIGS } from '@kepler.gl/constants';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';
import { injector, provideRecipesToInjector, LayerConfiguratorFactory } from '@kepler.gl/components';

import { replaceLayerConfigurator, speedRangeBounds } from './flowFieldConfigurator';
import { FLOW_FIELD_VIS_CONFIGS } from './flowFieldLayer';
import { FLOW_FIELD_MESSAGES } from './flowFieldMessages';

/** What a test changes about the layer the panel is handed. */
interface PanelOverrides {
  visConfig?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/**
 * The layer as the panel sees it: the knobs it registered, at their defaults.
 *
 * Built from the layer's own registry rather than hand-written, so a knob that
 * is renamed or dropped shows up here instead of in a panel nobody opened.
 */
function flowFieldLayer(columnMode = 'gradient', overrides: PanelOverrides = {}) {
  const presets = LAYER_VIS_CONFIGS as unknown as Record<string, { defaultValue?: unknown }>;
  // kepler's own rule, and the reason this is resolved rather than copied: a
  // string names one of kepler's presets, an object brings its own definition.
  const visConfigSettings = Object.fromEntries(
    Object.entries(FLOW_FIELD_VIS_CONFIGS as unknown as Record<string, unknown>).map(([key, setting]) => [
      key,
      typeof setting === 'string' ? presets[setting] : setting,
    ])
  ) as Record<string, { defaultValue?: unknown }>;

  const visConfig = Object.fromEntries(
    Object.entries(visConfigSettings).map(([key, setting]) => [key, setting?.defaultValue])
  );

  return {
    id: 'layer-1',
    type: 'flowfield',
    // `colorUI` is kepler's own per-property state for the colour pickers; the
    // range selector reads it before anything is opened.
    config: {
      visConfig: { ...visConfig, ...overrides.visConfig },
      columnMode,
      color: [255, 255, 255],
      colorUI: { colorRange: {} },
    },
    visConfigSettings,
    // Where the layer leaves what it learnt from tracing — the field's speed
    // range among it.
    meta: overrides.meta ?? {},
  };
}

/** The panel kepler renders for a flow field, through the lookup it really uses. */
function renderPanel(columnMode?: string, overrides: PanelOverrides = {}) {
  const appInjector = provideRecipesToInjector([replaceLayerConfigurator() as never], injector());
  const Configurator = appInjector.get(LayerConfiguratorFactory) as unknown as new (props: unknown) => object;
  const layer = flowFieldLayer(columnMode, overrides);
  // What the panel asks kepler to change — the whole of its contract with it.
  const onChange = jest.fn();

  const node = (
    Configurator.prototype as unknown as Record<string, (args: unknown) => React.ReactElement>
  )._renderFlowfieldLayerConfig({
    layer,
    visConfiguratorProps: { layer, onChange },
    layerConfiguratorProps: { layer, onChange: jest.fn() },
  });

  const rendered = render(
    <IntlProvider locale="en" messages={{ ...messages.en, ...FLOW_FIELD_MESSAGES }}>
      <ThemeProvider theme={theme}>{node}</ThemeProvider>
    </IntlProvider>
  );
  return { ...rendered, onChange };
}

describe('the flow field panel', () => {
  it('offers the gradient direction, in words rather than as a key', () => {
    // A selector showing `downhill` would be the same failure as a label
    // reading "Flowfield.Density": the value reaching the screen raw because
    // nothing translated it.
    const { container } = renderPanel();

    expect(container.textContent).toContain('Downhill');
  });

  it('keeps the direction out of the panel when the field is a wind', () => {
    // u and v already say which way the air goes. Offering to reverse them here
    // would be a knob that does nothing, which is worse than no knob.
    const { container } = renderPanel('components');

    expect(container.textContent).not.toContain('Downhill');
  });
});

describe('the colour range set by hand', () => {
  /** A wind layer whose field was traced at 2–14 m/s. */
  const wind = (visConfig: Record<string, unknown>) =>
    renderPanel('components', { visConfig, meta: { speedDomain: [2, 14] } });

  const theSwitch = (container: HTMLElement) =>
    container.querySelector('#layer-1-fixedSpeedRange-switch') as HTMLElement;

  it('offers the range only once the switch is on', () => {
    expect(wind({ fixedSpeedRange: false, speedRange: [2, 14] }).container.textContent).not.toContain(
      'Range (min, max)'
    );
    expect(wind({ fixedSpeedRange: true, speedRange: [2, 14] }).container.textContent).toContain(
      'Range (min, max)'
    );
  });

  it('starts the range at the field’s own the first time it is switched on', () => {
    // No default could do this job: wind is tens of metres a second, a slope a
    // few hundredths, and a range that starts wrong by orders of magnitude
    // paints the whole field one colour.
    const { container, onChange } = wind({ fixedSpeedRange: false, speedRange: null });

    fireEvent.click(theSwitch(container));

    expect(onChange).toHaveBeenCalledWith({ fixedSpeedRange: true, speedRange: [2, 14] });
  });

  it('rounds the range it starts from outwards, to the slider’s own step', () => {
    // A real field's range is whatever floats the magnitudes came to, and the
    // number boxes print them whole: "3.8644261360168457". Rounded outwards so
    // the fastest and slowest lines stay inside it. Measured 2–8.4 m/s gives a
    // slider to 20 in steps of 0.04, so 3.84 and 8.44.
    const { container, onChange } = renderPanel('components', {
      visConfig: { fixedSpeedRange: false, speedRange: null },
      meta: { speedDomain: [3.8644261360168457, 8.411197630750438] },
    });

    fireEvent.click(theSwitch(container));

    expect(onChange).toHaveBeenCalledWith({ fixedSpeedRange: true, speedRange: [3.84, 8.44] });
  });

  it('keeps a range already chosen when it is switched back on', () => {
    const { container, onChange } = wind({ fixedSpeedRange: false, speedRange: [0, 40] });

    fireEvent.click(theSwitch(container));

    expect(onChange).toHaveBeenCalledWith({ fixedSpeedRange: true });
  });
});

describe('width and opacity by speed', () => {
  const panelText = (visConfig: Record<string, unknown>) =>
    renderPanel('components', { visConfig, meta: { speedDomain: [2, 14] } }).container.textContent ?? '';

  it('offers a width range in place of the one width while widths follow speed', () => {
    const text = panelText({ widthBySpeed: true, widthRange: [1, 4] });

    expect(text).toContain('Width range (px)');
    expect(text).not.toContain('Stroke Width (Pixels)');
  });

  it('offers the calm opacity only while opacity follows speed', () => {
    expect(panelText({ opacityBySpeed: false })).not.toContain('Opacity in calm air');
    expect(panelText({ opacityBySpeed: true })).toContain('Opacity in calm air');
  });

  it('still offers the fixed range when only the widths follow speed', () => {
    // The range is what all three encodings are measured against. Hidden along
    // with the colour, it would leave the widths with no way to be made the
    // same on two panels.
    expect(panelText({ colorBySpeed: false, widthBySpeed: true })).toContain('Fixed speed range');
  });
});

describe('speedRangeBounds', () => {
  it('gives a wind room above its fastest cell, in steps a person can drag', () => {
    const { range, step } = speedRangeBounds([2, 14]);

    expect(range).toEqual([0, 50]);
    expect(step).toBeCloseTo(0.1, 10);
  });

  it('scales down to a slope, whose values a wind-sized step would skip', () => {
    // A step of 0.1 on a range of 0.05 leaves the slider two positions: zero
    // and past the end.
    const { range, step } = speedRangeBounds([0.001, 0.02]);

    expect(range[0]).toBe(0);
    expect(range[1]).toBeCloseTo(0.05, 10);
    expect(step).toBeCloseTo(0.0001, 10);
  });
});
