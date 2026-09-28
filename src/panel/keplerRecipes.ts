import { replaceAnimationController } from './animationSweepFix';
import { replaceMapControl } from './effectsMapControl';
import { replaceLayerConfigurator } from './flowFieldConfigurator';
import { replaceMapContainer } from './haloMapContainer';
import { replaceLayerPanelHeader } from './layerPanelHeader';
import { replaceMapPopoverContent } from './selectPopover';

/**
 * The component replacements the panel hands `injectComponents`, in the order
 * they have to be applied.
 *
 * The order is load-bearing, and not for taste. `provideRecipesToInjector`
 * walks this list and, for each recipe, re-registers every factory in the
 * *replacement's* dependency tree as kepler's own
 * (`@kepler.gl/components/dist/esm/injector.js`, the `flattenDeps` reduce). So
 * a recipe listed later silently undoes an earlier one whose factory it happens
 * to depend on. kepler does warn, in a console message nobody reads because the
 * names are minified:
 *
 * ```
 * go already injected from $r, injecting UL after $r will override it
 * ```
 *
 * This bit once already: the map control and the layer configurator both pull
 * the range brush in transitively, and a brush repair this list carried until
 * kepler.gl 3.3.0-alpha.15 stopped happening the day the layer configurator
 * was added ahead of it.
 *
 * The rule to follow when adding one: smallest dependency tree last. There is
 * no runtime symptom to catch this, so `keplerRecipes.test.ts` resolves the
 * whole list and checks every replacement survives.
 *
 * The map container is the extreme case: its tree holds the popup and the map
 * control this list replaces, so it goes first.
 *
 * Kept out of `KeplerMap.tsx` so the test can read the real list rather than a
 * copy of it — a copy would have gone on passing while the panel broke.
 */
export function keplerRecipes(): Array<[unknown, unknown]> {
  return [
    replaceMapContainer(),
    replaceMapControl(),
    replaceAnimationController(),
    replaceLayerConfigurator(),
    replaceLayerPanelHeader(),
    replaceMapPopoverContent(),
  ] as Array<[unknown, unknown]>;
}
