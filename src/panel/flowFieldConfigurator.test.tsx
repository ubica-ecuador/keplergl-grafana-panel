import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { LAYER_VIS_CONFIGS } from '@kepler.gl/constants';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';
import { injector, provideRecipesToInjector, LayerConfiguratorFactory } from '@kepler.gl/components';

import { replaceLayerConfigurator } from './flowFieldConfigurator';
import { FLOW_FIELD_VIS_CONFIGS } from './flowFieldLayer';
import { FLOW_FIELD_MESSAGES } from './flowFieldMessages';

/**
 * The layer as the panel sees it: the knobs it registered, at their defaults.
 *
 * Built from the layer's own registry rather than hand-written, so a knob that
 * is renamed or dropped shows up here instead of in a panel nobody opened.
 */
function flowFieldLayer(columnMode = 'gradient') {
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
    config: { visConfig, columnMode, color: [255, 255, 255], colorUI: { colorRange: {} } },
    visConfigSettings,
  };
}

/** The panel kepler renders for a flow field, through the lookup it really uses. */
function renderPanel(columnMode?: string) {
  const appInjector = provideRecipesToInjector([replaceLayerConfigurator() as never], injector());
  const Configurator = appInjector.get(LayerConfiguratorFactory) as unknown as new (props: unknown) => object;
  const layer = flowFieldLayer(columnMode);

  const node = (
    Configurator.prototype as unknown as Record<string, (args: unknown) => React.ReactElement>
  )._renderFlowfieldLayerConfig({
    layer,
    visConfiguratorProps: { layer, onChange: jest.fn() },
    layerConfiguratorProps: { layer, onChange: jest.fn() },
  });

  return render(
    <IntlProvider locale="en" messages={{ ...messages.en, ...FLOW_FIELD_MESSAGES }}>
      <ThemeProvider theme={theme}>{node}</ThemeProvider>
    </IntlProvider>
  );
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
