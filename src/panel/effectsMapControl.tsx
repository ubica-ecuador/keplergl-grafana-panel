import React from 'react';
import styled from 'styled-components';
import { EffectControlFactory, EffectManagerFactory, MapControlFactory } from '@kepler.gl/components';

/**
 * kepler ships the whole effects feature — button, panel, reducer state, deck
 * lighting/post-processing — but its stock MapControl never puts the button in
 * the toolbar, and nothing in the core mounts the EffectManager panel. Both
 * are wired by the host app replacing MapControlFactory, which is exactly what
 * kepler's own demo app does; this factory is that wiring, minus the
 * demo-only extras (SQL panel, AI assistant, sample panels).
 */

type Factory = typeof MapControlFactory;

const StyledMapControlPanel = styled.div`
  position: relative;
`;

/* Column that hosts the EffectManager beside the button toolbar.
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
  max-height: calc(
    100% - ${(props) => props.theme.rightPanelMarginTop + props.theme.bottomWidgetPaddingBottom}px
  );
`;

CustomMapControlFactory.deps = [EffectControlFactory, EffectManagerFactory, ...MapControlFactory.deps];

function CustomMapControlFactory(
  EffectControl: ReturnType<typeof EffectControlFactory>,
  EffectManager: ReturnType<typeof EffectManagerFactory>,
  ...deps: Parameters<typeof MapControlFactory>
) {
  const MapControl = MapControlFactory(...deps);
  const actionComponents = [...(MapControl.defaultActionComponents ?? []), EffectControl];
  // The factory's d.ts types the inner component (props with intl and vis
  // state), but at runtime the injector hands over the component already
  // wrapped in withState + injectIntl, so it mounts with no props.
  const MountedEffectManager = EffectManager as unknown as React.FC;

  const CustomMapControl: React.FC<React.ComponentProps<typeof MapControl>> = (props) => {
    const showEffects = Boolean(props.mapControls?.effect?.active);
    return (
      <StyledMapControlOverlay top={props.top} rightPanelVisible={showEffects}>
        <StyledMapControlPanel>
          {/* top is consumed by the overlay; the inner toolbar starts at 0. */}
          <MapControl {...props} top={0} actionComponents={actionComponents} />
        </StyledMapControlPanel>
        <StyledMapControlContextPanel>{showEffects ? <MountedEffectManager /> : null}</StyledMapControlContextPanel>
      </StyledMapControlOverlay>
    );
  };

  return CustomMapControl;
}

/** The recipe `injectComponents` expects to swap the stock map control. */
export function replaceMapControl(): [Factory, Factory] {
  return [MapControlFactory, CustomMapControlFactory as unknown as Factory];
}
