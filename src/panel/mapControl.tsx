import React from 'react';
import styled from 'styled-components';
import {
  AnnotationManagerFactory,
  ChartControlFactory,
  EffectControlFactory,
  EffectManagerFactory,
  MapControlFactory,
} from '@kepler.gl/components';
import { ChartManagerFactory } from '@kepler.gl/components/charts';
import { getApplicationConfig } from '@kepler.gl/utils';

/**
 * The map control, with the three features kepler ships complete but never
 * mounts: **effects**, **charts** and the **annotation list**.
 *
 * For both, kepler provides the button, the manager panel, the reducer state and
 * the rendering, but its stock MapControl puts neither button in the toolbar
 * and nothing in the core mounts either manager. Both are wired by the host app
 * replacing MapControlFactory, which is exactly what kepler's own demo app does
 * (`examples/demo-app/src/factories/map-control.js`). This factory is that
 * wiring, minus the demo-only extras (SQL panel, AI assistant, sample panels).
 *
 * The annotations themselves come from kepler's stock parts: the "Aa" button is
 * in the stock MapControl, the map's right-click menu offers "Add Annotation"
 * (on an empty spot; on a feature with a tooltip it pins the tooltip instead),
 * and `enableAnnotations` defaults to true. The list (`AnnotationManager`:
 * every note with its eye, kind, colour, line and text placement, duplicate
 * and delete) is mounted here while "Aa" is on, as the demo mounts it. Grafana
 * annotations reach the map, and map notes reach Grafana, through
 * `useGrafanaAnnotations`.
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

  /* kepler's annotation list is a scrolling flex column whose rows may shrink:
     with more notes than fit, every row is squeezed (its second line, the kind,
     cut off) instead of the list scrolling. Rows keep their height here. The
     list is the panel's second child, after its header. */
  .annotation-manager > div > div:nth-child(2) > * {
    flex-shrink: 0;
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
  AnnotationManagerFactory,
  ChartControlFactory,
  ChartManagerFactory,
  ...MapControlFactory.deps,
];

function CustomMapControlFactory(
  EffectControl: ReturnType<typeof EffectControlFactory>,
  EffectManager: ReturnType<typeof EffectManagerFactory>,
  AnnotationManager: ReturnType<typeof AnnotationManagerFactory>,
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
  const MountedAnnotationManager = AnnotationManager as unknown as React.FC;
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
    // "Aa" on: kepler's annotation mode, where notes can be picked and edited.
    const showAnnotations = !isExport && Boolean(props.mapControls?.annotation?.active);
    const chartPanelActive = chartsEnabled && Boolean(props.mapControls?.chart?.active);
    // A pinned chart stays on the map with the panel closed, like a pinned
    // legend. `pinned` undefined counts as pinned: kepler's loader reads older
    // saved maps that way (`pinned: chart.pinned !== false`). An exported map
    // leaves them out, as the demo does.
    const hasPinnedCharts = !isExport && chartsEnabled && (props.charts ?? []).some((chart) => chart.pinned !== false);
    const showCharts = chartPanelActive || hasPinnedCharts;

    return (
      <StyledMapControlOverlay top={props.top} rightPanelVisible={showEffects || showAnnotations || showCharts}>
        <StyledMapControlPanel>
          {/* top is consumed by the overlay; the inner toolbar starts at 0. */}
          <MapControl {...props} top={0} actionComponents={actionComponents} />
        </StyledMapControlPanel>
        <StyledMapControlContextPanel>
          {showAnnotations ? <MountedAnnotationManager /> : null}
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
