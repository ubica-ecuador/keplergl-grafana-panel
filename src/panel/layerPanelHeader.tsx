import React from 'react';
import { LayerPanelHeaderFactory } from '@kepler.gl/components';

import { FLOW_FIELD_TYPE } from './flowFieldLayer';

type Factory = typeof LayerPanelHeaderFactory;

/**
 * The id a layer card looks its type's name up under, where that is not the
 * layer's own type.
 *
 * kepler's layer card writes the type under the layer's name from
 * `layer.type.<type>`, lower-cased. Since 3.3.0-alpha.12 kepler has a
 * `flowField` of its own, which lower-cases to the same id as this plugin's
 * `flowfield` — so one message would name both cards, whichever of the two it
 * called them. The type itself cannot move: it is what a saved dashboard
 * stores. So the card is handed another id to look up, and only for this
 * plugin's layer.
 */
const OWN_HEADER_TYPES: Record<string, string> = {
  [FLOW_FIELD_TYPE]: 'streamlines',
};

export function headerLayerType<T extends string | null | undefined>(type: T): T | string {
  return typeof type === 'string' && type in OWN_HEADER_TYPES ? OWN_HEADER_TYPES[type] : type;
}

/** kepler's header, handed the id `headerLayerType` picks and nothing else changed. */
export function withOwnHeaderNames<P extends { layerType?: string | null }>(
  Header: React.ComponentType<P>
): React.FC<P> {
  function LayerPanelHeaderWithOwnNames(props: P) {
    return <Header {...props} layerType={headerLayerType(props.layerType)} />;
  }
  return LayerPanelHeaderWithOwnNames;
}

CustomLayerPanelHeaderFactory.deps = LayerPanelHeaderFactory.deps;

function CustomLayerPanelHeaderFactory(...deps: Parameters<Factory>) {
  return withOwnHeaderNames(LayerPanelHeaderFactory(...deps));
}

/** The recipe `injectComponents` expects to swap the stock layer panel header. */
export function replaceLayerPanelHeader(): [Factory, Factory] {
  return [LayerPanelHeaderFactory, CustomLayerPanelHeaderFactory as unknown as Factory];
}
