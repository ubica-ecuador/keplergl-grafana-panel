import React from 'react';

import { repeatWorldCopies } from './worldCopies';

type DeckProps = Record<string, unknown>;
type OnDeckRender = (deckProps: DeckProps) => DeckProps | null;

interface Props {
  deckRenderCallbacks?: { onDeckRender?: OnDeckRender } & Record<string, unknown>;
}

/**
 * kepler's `MapContainer`, its deck drawing the layers on every world copy the
 * base map shows (`worldCopies.ts`). Only the view changes: the layers, and
 * whatever the other wrappers add to them, are handed on as they come.
 */
export function withWorldCopies<P extends Props>(MapContainer: React.ComponentType<P>): React.FC<P> {
  const MapContainerOnWorldCopies: React.FC<P> = (props) => {
    const chained = props.deckRenderCallbacks?.onDeckRender;
    const onDeckRender = (deckProps: DeckProps) => repeatWorldCopies(chained ? chained(deckProps) : deckProps);
    return <MapContainer {...props} deckRenderCallbacks={{ ...props.deckRenderCallbacks, onDeckRender }} />;
  };
  return MapContainerOnWorldCopies;
}
