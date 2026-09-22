import taxonomy from '../icons/symbol-categories.json';
import maki from '../icons/maki-paths.json';
import { ALL_CATEGORY, categoriesOf, categoryOf, symbolCategories, symbolsIn } from './symbolCategories';
import { OCHA_ICONS, symbolNames, TEMAKI_ICONS } from './symbolGlyphs';

describe('symbolCategories', () => {
  it("offers All first, then the taxonomy's sixteen in its order", () => {
    expect(symbolCategories().map((category) => category.id)).toEqual([
      'all',
      'shapes',
      'hazards',
      'weather',
      'emergency',
      'impact',
      'transport',
      'roads',
      'power',
      'telecom',
      'water',
      'nature',
      'buildings',
      'recreation',
      'food',
      'people',
      'tools',
    ]);
    expect(symbolCategories()[0]).toEqual({ id: ALL_CATEGORY, label: 'All' });
    expect(symbolCategories()).toBe(symbolCategories());
  });
});

describe('the taxonomy', () => {
  it('puts every offered symbol in at least one category', () => {
    expect(symbolNames().filter((name) => categoriesOf(name).length === 0)).toEqual([]);
  });

  it('leaves no category empty', () => {
    for (const { id } of symbolCategories()) {
      expect(symbolsIn(id).length).toBeGreaterThan(0);
    }
  });

  it('maps every group Temaki uses', () => {
    const groups = new Set(Object.values(TEMAKI_ICONS.icons).flatMap((icon) => icon.groups ?? []));

    expect([...groups].filter((group) => !(group in taxonomy.temakiGroups))).toEqual([]);
  });

  it('names only icons that exist, and only categories it defines', () => {
    const ids = new Set(taxonomy.categories.map((category) => category.id));
    const used = [
      ...Object.values(taxonomy.temakiGroups),
      ...Object.values(taxonomy.temaki),
      ...Object.values(taxonomy.maki),
      ...Object.values(taxonomy.ocha),
    ].flat();

    expect(Object.keys(taxonomy.maki).filter((name) => !(name in maki.paths))).toEqual([]);
    expect(Object.keys(taxonomy.temaki).filter((name) => !(name in TEMAKI_ICONS.icons))).toEqual([]);
    expect(Object.keys(taxonomy.ocha).sort()).toEqual(Object.keys(OCHA_ICONS.icons).sort());
    expect(used.filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe('categoryOf', () => {
  it("answers the first of a symbol's categories in the taxonomy's order", () => {
    // Temaki's `water` group, plus the extra entry that makes it an emergency symbol.
    expect(categoriesOf('temaki:fire_hydrant')).toEqual(['emergency', 'water']);
    expect(categoryOf('temaki:fire_hydrant')).toBe('emergency');
    expect(categoryOf('temaki:power_tower')).toBe('power');
    expect(categoriesOf('volcano')).toEqual(['hazards', 'nature']);
    expect(categoryOf('arrow')).toBe('shapes');
    expect(categoryOf('ocha:flood')).toBe('hazards');
    expect(categoriesOf('ocha:bridge-destroyed')).toEqual(['impact', 'roads']);
  });

  it('answers All for a symbol the picker does not offer', () => {
    expect(categoryOf('directions')).toBe(ALL_CATEGORY);
    expect(categoryOf('no-such-glyph')).toBe(ALL_CATEGORY);
    expect(categoriesOf('directions')).toEqual([]);
  });
});

describe('symbolsIn', () => {
  it('keeps the order of symbolNames, and the same array between calls', () => {
    const hazards = symbolsIn('hazards');

    expect(hazards).toEqual(symbolNames().filter((name) => hazards.includes(name)));
    expect(symbolsIn('hazards')).toBe(hazards);
    expect(symbolsIn(ALL_CATEGORY)).toBe(symbolNames());
  });

  it('mixes the sources in one category', () => {
    expect(symbolsIn('hazards')).toEqual(
      expect.arrayContaining(['volcano', 'temaki:radiation', 'ocha:earthquake', 'ocha:flood'])
    );
    expect(symbolsIn('shapes')).toEqual(expect.arrayContaining(['arrow', 'pin', 'marker']));
  });

  it('lists nothing for a category that does not exist', () => {
    expect(symbolsIn('no-such-category')).toEqual([]);
  });
});
