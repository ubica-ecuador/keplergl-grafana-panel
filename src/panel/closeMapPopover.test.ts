import { onLayerClick, registerEntry, wrapTo } from '@kepler.gl/actions';

import { KEPLER_INSTANCE_ID } from './constants';
import { closeMapPopover } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

/**
 * Closing the map's popup from outside it.
 *
 * The popup's Select button has no way to close the popup it sits in: kepler
 * hands `onClose` to the popover, not to the content this plugin replaces. So
 * the panel closes it the way kepler's own close button does — by clearing the
 * click state — and this runs that against kepler's real reducer rather than
 * asserting on an action shape that a bump could quietly redefine.
 */
it('leaves kepler holding no clicked entity', () => {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }));
  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, onLayerClick({ index: 0, picked: true } as never)));

  const visState = () =>
    (store.getState() as { keplerGl: Record<string, { visState: { clicked: unknown } }> }).keplerGl[KEPLER_INSTANCE_ID]
      .visState;
  expect(visState().clicked).not.toBeNull();

  closeMapPopover(store.dispatch);

  expect(visState().clicked).toBeNull();
});
