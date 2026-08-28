import { replaceAnimationController } from './animationSweepFix';
import { replaceMapControl } from './effectsMapControl';
import { replaceLayerConfigurator } from './flowFieldConfigurator';
import { replaceRangeBrush } from './rangeBrushFix';

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
 * The map control and the layer configurator both pull the range brush in
 * transitively, so the brush has to come **after** them. Listed before, its
 * repair never happens and the time slider is buried under its own histogram
 * again — which is exactly what adding the layer configurator did.
 *
 * The rule to follow when adding one: smallest dependency tree last. There is
 * no runtime symptom to catch this, so `keplerRecipes.test.ts` resolves the
 * whole list and checks every replacement survives.
 *
 * Kept out of `KeplerMap.tsx` so the test can read the real list rather than a
 * copy of it — a copy would have gone on passing while the panel broke.
 */
export function keplerRecipes(): Array<[unknown, unknown]> {
  return [
    replaceMapControl(),
    replaceAnimationController(),
    replaceLayerConfigurator(),
    replaceRangeBrush(),
  ] as Array<[unknown, unknown]>;
}
