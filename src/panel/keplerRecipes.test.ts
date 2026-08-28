import {
  injector,
  provideRecipesToInjector,
  AnimationControllerFactory,
  LayerConfiguratorFactory,
  MapControlFactory,
  RangeBrushFactory,
} from '@kepler.gl/components';

import { keplerRecipes } from './keplerRecipes';

/**
 * Every replacement the panel makes, resolved together, from the real list.
 *
 * Each repair has its own test proving it resolves **on its own**, and that is
 * a different question. `injectComponents` is handed all of them at once, and
 * `provideRecipesToInjector` re-registers each replacement's dependency tree as
 * kepler's own — so a recipe listed after another whose factory it depends on
 * silently undoes it. Nothing throws and nothing renders differently until
 * someone notices the repair stopped happening: the time slider buried under
 * its own histogram, the effects button gone.
 *
 * That is not hypothetical. Adding the layer configurator put the range brush
 * back to kepler's, and the buried slider came back with it.
 *
 * Deliberately reads `keplerRecipes()` rather than listing the recipes again: a
 * copy would have gone on passing while the panel broke.
 */
describe('the recipes the panel injects', () => {
  const resolve = () => provideRecipesToInjector(keplerRecipes() as Array<[never, never]>, injector());

  // By name, not identity: a factory builds a fresh component every call, so
  // the same recipe resolved twice is never the same object.
  const nameOf = (component: unknown) =>
    (component as { name?: string; displayName?: string })?.name ??
    (component as { displayName?: string })?.displayName ??
    '(anonymous)';

  it.each([
    ['the map control', MapControlFactory, 'CustomMapControl'],
    ['the animation controller', AnimationControllerFactory, 'SweepingAnimationController'],
    ['the layer configurator', LayerConfiguratorFactory, 'LayerConfiguratorWithFlowField'],
    ['the range brush', RangeBrushFactory, 'BrushOnTop'],
  ])('still replaces %s when the whole list is provided', (_name, stock, expected) => {
    expect(nameOf(resolve().get(stock as never))).toBe(expected);
  });
});
