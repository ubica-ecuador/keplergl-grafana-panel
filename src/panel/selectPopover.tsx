import React, { createContext, useContext } from 'react';
import { useSelector } from 'react-redux';
import styled from 'styled-components';
import { MapPopoverContentFactory } from '@kepler.gl/components';

import { KEPLER_INSTANCE_ID } from './constants';
import { isClickMapping, type VariableMapping } from './variableSync';
import type { ClickSelectActions } from './useClickSync';
import type { ClickAreaActions } from './useClickArea';

type Factory = typeof MapPopoverContentFactory;

/**
 * Turning the map's popup into the place where a selection is made.
 *
 * Without this, clicking an entity *is* selecting it: the click publishes the
 * dashboard variables, and everything that reads them — another tab, a heavy
 * query — moves at once, whether the user wanted to select or only to look.
 * With the panel's confirm mode on, the click only opens kepler's popup and
 * this button is what publishes.
 *
 * It is added by replacing `MapPopoverContentFactory` rather than
 * `MapPopoverFactory`, and that is the one non-obvious part. The popover
 * renders its own floating portal and the box inside it, so anything a wrapper
 * of *it* returns lands outside the box; the content is what renders within.
 * The cost is that the content is handed no `frozen` prop, so whether this
 * popup is the pinned one — rather than the one following the pointer — is
 * read from the store, where kepler keeps it.
 */

/** What the panel offers the popup: whether to ask, and the two things to do. */
export interface SelectApi {
  /** Whether this panel asks the user to confirm from the popup at all. */
  armed: boolean;
  /** Whether the entity showing is the one the variables already hold. */
  isSelected: () => boolean;
  /** Do what the click used to do: publish, and place the search square. */
  select: () => void;
  /** Empty the mapped variables. */
  clear: () => void;
}

/**
 * The panel's own channel to the popup, null in a panel that never confirms.
 *
 * A context rather than a module-level handle because a dashboard can hold two
 * kepler panels, and each one's popup must reach its own panel's variables.
 * React context crosses the floating portal kepler renders the popup through,
 * since the portal moves the DOM node and not the element tree.
 */
export const SelectContext = createContext<SelectApi | null>(null);

/**
 * Whether this panel's popup should carry the button at all.
 *
 * The mode is a switch the user sets, but a switch on a panel where a click
 * selects nothing — no click mapping, no search square — would put a button in
 * the popup with nothing to do. Ordinary filter mappings do not count: they are
 * driven by kepler's own filters, not by clicking the map.
 */
export function offersSelection({
  confirm,
  mappings,
  clickArea,
}: {
  confirm: boolean;
  mappings: VariableMapping[];
  /** Whether the click also places the search square — `clickArea` and its variable. */
  clickArea: boolean;
}): boolean {
  return confirm && (clickArea || mappings.some(isClickMapping));
}

/**
 * The one button, out of the two hooks a click used to drive and the popup it
 * sits in.
 *
 * Order is load-bearing: both writers resolve the entity from kepler's click
 * state, and closing the popup is exactly what clears it, so the close comes
 * last. It comes at all because the popup would otherwise sit there offering
 * "Select" for an entity it had just selected — nothing re-renders it when the
 * variables move — and because a map whose own query reads the variable closes
 * it anyway on the refresh a moment later.
 */
export function selectApi({
  armed,
  variables,
  area,
  close,
}: {
  armed: boolean;
  variables: ClickSelectActions;
  area: ClickAreaActions;
  close: () => void;
}): SelectApi {
  return {
    armed,
    isSelected: () => variables.isSelected(),
    select: () => {
      variables.select();
      area.select();
      close();
    },
    clear: () => {
      variables.clear();
      close();
    },
  };
}

const StyledSelect = styled.button`
  align-self: flex-start;
  margin-top: 4px;
  padding: 4px 10px;
  border: 1px solid ${(props) => props.theme?.textColor ?? 'currentColor'};
  border-radius: 2px;
  background: transparent;
  color: ${(props) => props.theme?.textColorHl ?? 'inherit'};
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    color: ${(props) => props.theme?.linkBtnColor ?? 'inherit'};
    border-color: ${(props) => props.theme?.linkBtnColor ?? 'currentColor'};
  }
`;

/** Whether kepler is holding a clicked entity — that is, this popup is pinned. */
function usePinned(): boolean {
  return useSelector((state: unknown) =>
    Boolean(
      (state as { keplerGl?: Record<string, { visState?: { clicked?: unknown } }> })?.keplerGl?.[KEPLER_INSTANCE_ID]
        ?.visState?.clicked
    )
  );
}

/** kepler's popup content, with the panel's Select button under it. */
export function withSelectButton<P extends object>(Content: React.ComponentType<P>): React.FC<P> {
  const ContentWithSelect: React.FC<P> = (props) => {
    const api = useContext(SelectContext);
    const pinned = usePinned();
    // The hover popup selects nothing: hovering is not a gesture with intent,
    // and the entity it shows is not the one the pinned popup holds.
    const offer = Boolean(api?.armed) && pinned;
    const selected = offer && api ? api.isSelected() : false;

    return (
      <>
        <Content {...props} />
        {offer && api ? (
          <StyledSelect type="button" className="panel-select-entity" onClick={selected ? api.clear : api.select}>
            {selected ? 'Clear selection' : 'Select'}
          </StyledSelect>
        ) : null}
      </>
    );
  };

  return ContentWithSelect;
}

CustomMapPopoverContentFactory.deps = MapPopoverContentFactory.deps;

function CustomMapPopoverContentFactory(...deps: Parameters<Factory>) {
  return withSelectButton(MapPopoverContentFactory(...deps)) as unknown as ReturnType<Factory>;
}

/** The recipe `injectComponents` expects to swap the stock popup content. */
export function replaceMapPopoverContent(): [Factory, Factory] {
  return [MapPopoverContentFactory, CustomMapPopoverContentFactory as unknown as Factory];
}
