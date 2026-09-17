import { createIterable, UpdateParameters } from '@deck.gl/core';
import { IconLayer } from '@deck.gl/layers';

import { PictureError, pictureFetch } from './pictureFetch';
import { parsePictureKey } from './pictureKeys';
import { GenerationRecord, nextGeneration } from './pictureRows';
import { recordPictureOutcome } from './pictureState';

/**
 * The deck.gl layer that draws a picture per row.
 *
 * Handed no atlas, `IconLayer` packs its own from the icons `getIcon` names,
 * loads each through `loadOptions`, and redraws itself as each one arrives —
 * nothing needs kepler to render again. What it loads with is this plugin's
 * picture fetch; see `pictureFetch.ts` for why it is not loaders.gl's.
 */

/** The symbol layer's props that only its glyph atlases read. deck keeps any prop it is given. */
const GLYPH_ONLY_PROPS = ['picture', 'symbols', 'shadow', 'outline', 'gradient'];

/** A constant, so deck sees the same load options on every render. */
const LOAD_OPTIONS = { core: { fetch: pictureFetch } };

type IconIdentity = { id?: string; url?: string } | null | undefined;

/** What `IconLayer.initializeState` builds its manager with. */
type IconManagerClass = new (
  device: unknown,
  callbacks: { onUpdate: (didFrameChange: boolean) => void; onError: (event: unknown) => void }
) => { finalize(): void };

/** The ids deck's `IconManager` would pack for this data, walked the way it walks it. */
function iconIdsOf(data: unknown, getIcon: unknown): string[] {
  if (typeof getIcon !== 'function') {
    return [];
  }
  const ids = new Set<string>();
  const { iterable, objectInfo } = createIterable(data as never);
  for (const object of iterable) {
    objectInfo.index++;
    const icon = getIcon(object, objectInfo) as IconIdentity;
    const id = icon && (icon.id || icon.url);
    if (id) {
      ids.add(id);
    }
  }
  return [...ids];
}

/**
 * An `IconLayer` whose texture starts afresh once it would hold too many
 * pictures.
 *
 * deck's `IconManager` never forgets an icon: its mapping and texture only
 * grow while the layer lives. A dashboard whose pictures change on every
 * refresh would grow the texture without end, so once the pictures packed
 * since the manager was made and the ones this data asks for would pass the
 * cap, the manager is finalised — its texture freed — and replaced by a new
 * one, which packs only what is drawn now.
 *
 * Kept by the deck layer rather than by kepler's layer id: each panel's map is
 * its own `Deck`, while two panels — a repeated or duplicated one — can hold
 * kepler layers with the same id. The deck layer's id stays the same, so a
 * refresh that changes nothing about the pictures does not rebuild the texture.
 *
 * Reaches into `IconLayer` 9.3's internals — `state.iconManager`, `_onUpdate`,
 * `_onError` — to build the manager exactly as `initializeState` does; the
 * manager's class is taken from the live one, so no private module is imported.
 */
export class PictureIconLayer extends IconLayer {
  static layerName = 'PictureIconLayer';

  updateState(params: UpdateParameters<this>): void {
    const { props, changeFlags } = params;
    const triggers = changeFlags.updateTriggersChanged;
    // The condition `IconLayer.updateState` packs icons under, checked first so
    // the icons it packs go into the manager that will hold them.
    if (!props.iconAtlas && (changeFlags.dataChanged || (triggers && (triggers.all || triggers.getIcon)))) {
      this.renewIconManagerIfFull(props.data, props.getIcon);
    }
    super.updateState(params);
  }

  renewIconManagerIfFull(data: unknown, getIcon: unknown): void {
    const state = this.state as this['state'] & { pictures?: GenerationRecord };
    const previous = state.pictures;
    const next = nextGeneration(previous, iconIdsOf(data, getIcon));
    if (previous && next.generation !== previous.generation && state.iconManager) {
      const full = state.iconManager as unknown as { finalize(): void; constructor: IconManagerClass };
      const IconManager = full.constructor;
      full.finalize();
      const internals = this as unknown as {
        _onUpdate(didFrameChange: boolean): void;
        _onError(event: unknown): void;
      };
      state.iconManager = new IconManager(this.context.device, {
        onUpdate: internals._onUpdate.bind(this),
        onError: internals._onError.bind(this),
      }) as unknown as typeof state.iconManager;
    }
    state.pictures = next;
  }
}

/**
 * Called for any failed icon: one the fetch refused, which already said why,
 * or bytes loaders.gl could not decode, which nobody has.
 */
function onIconError(event: { url: string; error: unknown }): void {
  const parsed = parsePictureKey(event.url);
  if (parsed) {
    recordPictureOutcome(event.url, parsed.url, event.error instanceof PictureError ? event.error.problem : 'decode');
  }
}

export function buildPictureDeckLayer(props: Record<string, unknown>): unknown {
  const rest: Record<string, unknown> = { ...props };
  for (const key of GLYPH_ONLY_PROPS) {
    delete rest[key];
  }

  return new PictureIconLayer({
    getPosition: (row: { position: [number, number, number] }) => row.position,
    // Pixels, so a picture reads the same at every zoom.
    sizeUnits: 'pixels',
    billboard: false,
    ...rest,
    // `core.fetch`, not a top-level `fetch`: loaders.gl 4.4 keeps the latter
    // only as a deprecated alias.
    loadOptions: LOAD_OPTIONS,
    onIconError,
  } as never);
}
