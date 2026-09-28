import React from 'react';
import styled from 'styled-components';
import {
  ChartControlFactory,
  EffectControlFactory,
  EffectManagerFactory,
  MapControlFactory,
} from '@kepler.gl/components';
import { ChartManagerFactory } from '@kepler.gl/components/charts';
import { getApplicationConfig } from '@kepler.gl/utils';

/**
 * The map control, with the two features kepler ships complete but never
 * mounts: **effects** and **charts**.
 *
 * For both, kepler provides the button, the manager panel, the reducer state and
 * the rendering, but its stock MapControl puts neither button in the toolbar
 * and nothing in the core mounts either manager. Both are wired by the host app
 * replacing MapControlFactory, which is exactly what kepler's own demo app does
 * (`examples/demo-app/src/factories/map-control.js`). This factory is that
 * wiring, minus the demo-only extras (SQL panel, AI assistant, sample panels,
 * annotations).
 *
 * `ChartManagerFactory` comes from `@kepler.gl/components/charts`, a subpath
 * kepler keeps apart so its main barrel does not load `@kepler.gl/charts`.
 */

type Factory = typeof MapControlFactory;

const StyledMapControlPanel = styled.div`
  position: relative;
`;

/* Column that hosts the ChartManager and the EffectManager beside the button toolbar.
   pointer-events is disabled on the container and restored on children so the
   empty space above/below the panel keeps working as map surface. */
const StyledMapControlContextPanel = styled.div`
  max-height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none !important;
  & > * {
    pointer-events: all;
  }
`;

/* z-index 10 is kepler's own control column's. This overlay wraps that column, so
   its value is the one that competes with the map's other absolute children — the
   attribution, the scale and the loading badge, all at 1. Tied at 1, the
   attribution comes later in the DOM and wins: on a short panel it covered the
   legend button, and a click on the button opened kepler.gl/policy. */
const StyledMapControlOverlay = styled.div<{ top?: number; rightPanelVisible: boolean }>`
  position: absolute;
  display: flex;
  top: ${(props) => props.top ?? 0}px;
  right: 0;
  z-index: 10;
  pointer-events: none !important;
  & > * {
    pointer-events: all;
  }

  margin-top: ${(props) => (props.rightPanelVisible ? props.theme.rightPanelMarginTop : 0)}px;
  margin-right: ${(props) => (props.rightPanelVisible ? props.theme.rightPanelMarginRight : 0)}px;
  max-height: calc(100% - ${(props) => props.theme.rightPanelMarginTop + props.theme.bottomWidgetPaddingBottom}px);
`;

CustomMapControlFactory.deps = [
  EffectControlFactory,
  EffectManagerFactory,
  ChartControlFactory,
  ChartManagerFactory,
  ...MapControlFactory.deps,
];

function CustomMapControlFactory(
  EffectControl: ReturnType<typeof EffectControlFactory>,
  EffectManager: ReturnType<typeof EffectManagerFactory>,
  ChartControl: ReturnType<typeof ChartControlFactory>,
  ChartManager: ReturnType<typeof ChartManagerFactory>,
  ...deps: Parameters<typeof MapControlFactory>
) {
  const MapControl = MapControlFactory(...deps);
  // The factories' d.ts types the inner components (props with intl and vis
  // state), but at runtime the injector hands over each one already wrapped in
  // withState / injectIntl, reading the store for itself. The effect manager
  // mounts with no props; the chart manager takes `panelActive` and `isExport`.
  const MountedEffectManager = EffectManager as unknown as React.FC;
  const MountedChartManager = ChartManager as unknown as React.FC<{ panelActive?: boolean; isExport?: boolean }>;

  const CustomMapControl: React.FC<React.ComponentProps<typeof MapControl>> = (props) => {
    // Read per render, as the demo does: the switch is kepler's application
    // config, and the tests flip it.
    const chartsEnabled = Boolean(getApplicationConfig().enableChartsPanel);
    const isExport = Boolean(props.isExport);
    const actionComponents = [
      ...(MapControl.defaultActionComponents ?? []),
      ...(chartsEnabled ? [ChartControl] : []),
      EffectControl,
    ];
    const showEffects = Boolean(props.mapControls?.effect?.active);
    const chartPanelActive = chartsEnabled && Boolean(props.mapControls?.chart?.active);
    // A pinned chart stays on the map with the panel closed, like a pinned
    // legend. `pinned` undefined counts as pinned: kepler's loader reads older
    // saved maps that way (`pinned: chart.pinned !== false`). An exported map
    // leaves them out, as the demo does.
    const hasPinnedCharts = !isExport && chartsEnabled && (props.charts ?? []).some((chart) => chart.pinned !== false);
    const showCharts = chartPanelActive || hasPinnedCharts;

    return (
      <StyledMapControlOverlay top={props.top} rightPanelVisible={showEffects || showCharts}>
        <StyledMapControlPanel>
          {/* top is consumed by the overlay; the inner toolbar starts at 0. */}
          <MapControl {...props} top={0} actionComponents={actionComponents} />
        </StyledMapControlPanel>
        <StyledMapControlContextPanel>
          {showCharts ? <MountedChartManager panelActive={chartPanelActive} isExport={isExport} /> : null}
          {showEffects ? <MountedEffectManager /> : null}
        </StyledMapControlContextPanel>
      </StyledMapControlOverlay>
    );
  };

  return CustomMapControl;
}

/** The recipe `injectComponents` expects to swap the stock map control. */
export function replaceMapControl(): [Factory, Factory] {
  return [MapControlFactory, CustomMapControlFactory as unknown as Factory];
}
