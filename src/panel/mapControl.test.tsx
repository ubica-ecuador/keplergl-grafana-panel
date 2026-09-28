import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';
import { injector, provideRecipesToInjector, EffectManagerFactory, MapControlFactory } from '@kepler.gl/components';
import { ChartManagerFactory } from '@kepler.gl/components/charts';
import { initApplicationConfig } from '@kepler.gl/utils';

import { replaceMapControl } from './mapControl';

/**
 * Resolves the map control through kepler's own injector, exactly as
 * `injectComponents` does inside KeplerGl, so the composition under test is the
 * one the panel really renders.
 */
function resolveMapControl(extraRecipes: Array<[any, any]> = []) {
  const appInjector = provideRecipesToInjector([replaceMapControl(), ...extraRecipes], injector());
  return appInjector.get(MapControlFactory);
}

/**
 * The effect manager needs a live kepler store; its internals are kepler's to
 * test. What is ours is the wiring — that the factory mounts whatever the
 * injector hands it as EffectManager when the control is active — so the stub
 * is substituted through the injector, the supported extension point.
 */
function StubEffectManagerFactory() {
  const StubEffectManager = () => <div data-testid="effect-manager" />;
  return StubEffectManager;
}
StubEffectManagerFactory.deps = [] as typeof EffectManagerFactory.deps;

const controlProps = (active: boolean) => ({
  mapControls: { effect: { show: true, active } },
  onToggleMapControl: jest.fn(),
  top: 0,
});

const renderControl = (MapControl: React.ComponentType<any>, props: Record<string, unknown>) =>
  render(
    <ThemeProvider theme={theme}>
      <IntlProvider locale="en" messages={messages['en']}>
        <MapControl {...props} />
      </IntlProvider>
    </ThemeProvider>
  );

describe('replaceMapControl', () => {
  it("adds kepler's effects button to the stock map controls", () => {
    const MapControl = resolveMapControl();
    const props = controlProps(false);

    const { container } = renderControl(MapControl, props);
    const button = container.querySelector('button.toggle-effect');

    expect(button).not.toBeNull();

    fireEvent.click(button!);
    expect(props.onToggleMapControl).toHaveBeenCalledWith('effect');
  });

  it('mounts the effect manager only while the effect control is active', () => {
    const MapControl = resolveMapControl([[EffectManagerFactory, StubEffectManagerFactory]]);

    const inactive = renderControl(MapControl, controlProps(false));
    expect(inactive.queryByTestId('effect-manager')).toBeNull();
    inactive.unmount();

    const active = renderControl(MapControl, controlProps(true));
    expect(active.getByTestId('effect-manager')).not.toBeNull();
  });
});

/**
 * Stands in for kepler's chart manager, which needs a live store. It shows the
 * two props the control decides: whether the manager opens as the editor
 * (`panelActive`) or only draws the pinned charts, and whether the map is being
 * exported (`isExport`).
 */
function StubChartManagerFactory() {
  const StubChartManager = ({ panelActive, isExport }: { panelActive?: boolean; isExport?: boolean }) => (
    <div data-testid="chart-manager" data-panel-active={String(panelActive)} data-is-export={String(isExport)} />
  );
  return StubChartManager;
}
StubChartManagerFactory.deps = [] as unknown as typeof ChartManagerFactory.deps;

const chartProps = ({
  active = false,
  charts = [] as Array<{ id: string; pinned?: boolean }>,
  isExport = false,
}: { active?: boolean; charts?: Array<{ id: string; pinned?: boolean }>; isExport?: boolean } = {}) => ({
  mapControls: { effect: { show: true, active: false }, chart: { show: true, active } },
  charts,
  isExport,
  onToggleMapControl: jest.fn(),
  top: 0,
});

describe('replaceMapControl — charts', () => {
  const withStubManager = () => resolveMapControl([[ChartManagerFactory, StubChartManagerFactory]]);

  it("adds kepler's charts button, which toggles the chart control", () => {
    const props = chartProps();
    const { container } = renderControl(resolveMapControl(), props);
    const button = container.querySelector('button.toggle-chart-panel');

    expect(button).not.toBeNull();

    fireEvent.click(button!);
    expect(props.onToggleMapControl).toHaveBeenCalledWith('chart');
  });

  it('mounts the chart manager as the editor while the chart control is active', () => {
    const view = renderControl(withStubManager(), chartProps({ active: true }));

    expect(view.getByTestId('chart-manager').dataset.panelActive).toBe('true');
  });

  it('mounts it for a pinned chart with the control closed, only to draw it', () => {
    const view = renderControl(withStubManager(), chartProps({ charts: [{ id: 'c1', pinned: true }] }));

    expect(view.getByTestId('chart-manager').dataset.panelActive).toBe('false');
    expect(view.getByTestId('chart-manager').dataset.isExport).toBe('false');
  });

  it('leaves a pinned chart out of an exported map, as kepler’s demo does', () => {
    const view = renderControl(withStubManager(), chartProps({ charts: [{ id: 'c1', pinned: true }], isExport: true }));

    expect(view.queryByTestId('chart-manager')).toBeNull();
  });

  it('tells the chart manager the map is being exported', () => {
    const view = renderControl(withStubManager(), chartProps({ active: true, isExport: true }));

    expect(view.getByTestId('chart-manager').dataset.isExport).toBe('true');
  });

  it('counts a chart saved before `pinned` existed as pinned, as kepler’s loader does', () => {
    const view = renderControl(withStubManager(), chartProps({ charts: [{ id: 'c1' }] }));

    expect(view.getByTestId('chart-manager')).not.toBeNull();
  });

  it('leaves it out when the control is closed and nothing is pinned', () => {
    const view = renderControl(withStubManager(), chartProps({ charts: [{ id: 'c1', pinned: false }] }));

    expect(view.queryByTestId('chart-manager')).toBeNull();
  });

  describe('with the charts panel switched off', () => {
    beforeAll(() => initApplicationConfig({ enableChartsPanel: false }));
    afterAll(() => initApplicationConfig({ enableChartsPanel: true }));

    it('shows neither the button nor a pinned chart', () => {
      const view = renderControl(withStubManager(), chartProps({ charts: [{ id: 'c1', pinned: true }] }));

      expect(view.container.querySelector('button.toggle-chart-panel')).toBeNull();
      expect(view.queryByTestId('chart-manager')).toBeNull();
    });
  });
});
