import taxonomyFile from '../icons/symbol-categories.json';
import { OCHA_ICONS, ochaKey, ownGlyphs, symbolNames, TEMAKI_ICONS, TEMAKI_PREFIX } from './symbolGlyphs';

/**
 * The themes the symbol picker groups its symbols by.
 *
 * Our own, not any library's: a hazard is a hazard whether Maki, Temaki or
 * OCHA drew it, so a category mixes the sources. `symbol-categories.json` is
 * the one place they are decided: Temaki's own groups through a table, Maki's
 * and OCHA's icons one by one. `symbolCategories.test.ts` fails if a symbol is
 * left without a category.
 */

/** The category that lists every symbol the picker offers. */
export const ALL_CATEGORY = 'all';

export interface SymbolCategory {
  id: string;
  label: string;
}

interface Taxonomy {
  categories: SymbolCategory[];
  /** Each of Temaki's groups, to the categories its icons go to. */
  temakiGroups: Record<string, string[]>;
  /** Categories for particular Temaki icons, beyond their groups'. */
  temaki: Record<string, string[]>;
  maki: Record<string, string[]>;
  /** By OCHA's file name, as `ocha-paths.json` is keyed. */
  ocha: Record<string, string[]>;
}

const TAXONOMY = taxonomyFile as Taxonomy;

let categories: SymbolCategory[] | null = null;

/** «All», then the taxonomy's sixteen in its order; the same array every time. */
export function symbolCategories(): SymbolCategory[] {
  if (!categories) {
    categories = [{ id: ALL_CATEGORY, label: 'All' }, ...TAXONOMY.categories];
  }
  return categories;
}

let index: Map<string, string[]> | null = null;

/** Every offered symbol's categories, first to last in the taxonomy's order. */
function categoryIndex(): Map<string, string[]> {
  if (!index) {
    const order = new Map(TAXONOMY.categories.map((category, position) => [category.id, position]));
    const rank = (id: string) => order.get(id) ?? order.size;
    const own = new Set(ownGlyphs().map((glyph) => glyph.key));
    const ochaNames = new Map(Object.keys(OCHA_ICONS.icons).map((name) => [ochaKey(name), name]));

    const assigned = (name: string): string[] => {
      if (own.has(name)) {
        return ['shapes'];
      }
      if (name.startsWith(TEMAKI_PREFIX)) {
        const icon = name.slice(TEMAKI_PREFIX.length);
        const groups = TEMAKI_ICONS.icons[icon]?.groups ?? [];
        return [...groups.flatMap((group) => TAXONOMY.temakiGroups[group] ?? []), ...(TAXONOMY.temaki[icon] ?? [])];
      }
      const ochaName = ochaNames.get(name);
      if (ochaName !== undefined) {
        return TAXONOMY.ocha[ochaName] ?? [];
      }
      return TAXONOMY.maki[name] ?? [];
    };

    index = new Map(
      symbolNames().map((name) => [name, [...new Set(assigned(name))].sort((a, b) => rank(a) - rank(b))])
    );
  }
  return index;
}

/** A symbol's categories in the taxonomy's order; none for one the picker does not offer. */
export function categoriesOf(name: string): string[] {
  return categoryIndex().get(name) ?? [];
}

/**
 * The category the picker opens on for a symbol: the first of its own, or
 * «All» for one it does not offer — kepler's hidden icons, or a name this
 * build does not have.
 */
export function categoryOf(name: string): string {
  return categoriesOf(name)[0] ?? ALL_CATEGORY;
}

const members = new Map<string, string[]>();

/**
 * The symbols of a category, in the order of `symbolNames()`; all of them for
 * «All». The same array each time for the same category, so the list kepler
 * builds from it is not rebuilt on every render.
 */
export function symbolsIn(id: string): string[] {
  if (id === ALL_CATEGORY) {
    return symbolNames();
  }
  let found = members.get(id);
  if (!found) {
    found = symbolNames().filter((name) => categoriesOf(name).includes(id));
    members.set(id, found);
  }
  return found;
}
