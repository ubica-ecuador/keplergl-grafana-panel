import React from 'react';

import type { VariableMapping } from './variableSync';

/**
 * The panel's variable mappings, as KeplerMap uses them (their columns in kepler's names, `withKeplerFields`), and
 * whether clicks wait for the popup's button. Provided inside the map for what renders in kepler's own tree — the
 * map containers, and a build that draws more there, such as Plus's Fleet selection — which the panel's props do not
 * reach.
 */
export interface PanelMappings {
  mappings: VariableMapping[];
  confirm: boolean;
}

export const PanelMappingsContext = React.createContext<PanelMappings>({ mappings: [], confirm: false });
