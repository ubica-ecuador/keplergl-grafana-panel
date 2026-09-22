import React, { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { ItemSelector, PanelLabel, SidePanelSection } from '@kepler.gl/components';

import { SelectKnob, SelectKnobProps } from './selectKnob';
import { categoryOf, symbolCategories, symbolsIn } from './symbolCategories';
import { resolveSymbol } from './symbolGlyphs';
import { SymbolOption } from './symbolOption';

/**
 * The symbol picker of the symbol and markers layers: a category, then a
 * symbol of that category.
 *
 * About a thousand symbols are too many for one list, even searched: a search
 * finds a name you already know, not the icon you did not know was there. The
 * category narrows the list to one theme, and the search still works inside it.
 *
 * The category is the picker's own state, never the layer's. It opens on the
 * category of the symbol in use and is not saved, and choosing one changes what
 * is listed, not what is drawn. Nothing moves it afterwards. A symbol changed
 * from elsewhere (an undo, a restored config) stays shown through `keepChosen`,
 * even when the category does not list it, so no effect has to chase it — but
 * only when it is a name this build can actually draw: `keepChosen` shows the
 * value as itself, and a name `resolveSymbol` would fall back on would then
 * read as one thing while the preview beside it drew another.
 */
export function SymbolPicker({
  layer,
  visConfiguratorProps,
  property = 'symbol',
}: Pick<SelectKnobProps, 'layer' | 'visConfiguratorProps'> & { property?: string }) {
  const intl = useIntl();
  const chosen = layer.config.visConfig[property];
  const [category, setCategory] = useState(() => categoryOf(typeof chosen === 'string' ? chosen : ''));
  const categories = symbolCategories();
  const ids = useMemo(() => categories.map((entry) => entry.id), [categories]);

  // After the hooks, which must run on every render: no symbol knob, no
  // category to narrow it by.
  if (!layer.visConfigSettings[property]) {
    return null;
  }

  return (
    <>
      <SidePanelSection>
        <PanelLabel>{intl.formatMessage({ id: 'symbol.category' })}</PanelLabel>
        <ItemSelector
          selectedItems={category}
          options={ids}
          multiSelect={false}
          searchable={false}
          getOptionValue={(id: string) => id}
          // The taxonomy's own words: like the glyph names, they have no messages.
          displayOption={(id: string) => categories.find((entry) => entry.id === id)?.label ?? id}
          onChange={(value) => {
            if (typeof value === 'string') {
              setCategory(value);
            }
          }}
        />
      </SidePanelSection>
      <SelectKnob
        layer={layer}
        visConfiguratorProps={visConfiguratorProps}
        property={property}
        options={symbolsIn(category)}
        displayOption={(name) => name}
        searchable
        OptionComponent={SymbolOption}
        keepChosen={typeof chosen === 'string' && resolveSymbol(chosen) === chosen}
      />
    </>
  );
}
