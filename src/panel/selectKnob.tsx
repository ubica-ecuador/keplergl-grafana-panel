import React from 'react';
import { useIntl } from 'react-intl';
import { ItemSelector, PanelLabel, SidePanelSection } from '@kepler.gl/components';

/**
 * A choice among words, for a knob a layer registered as a `select`.
 *
 * kepler's sliders do not fit a choice among words; `ItemSelector` is what it
 * uses for its own. The label is the knob's own message id, and by default each
 * option is `<label>.<option>` — both through react-intl, because a selector
 * showing `downhill` is the same failure as a label reading "Flowfield.Density".
 *
 * Its own module because more than one panel uses it: the flow field and vector
 * field panels, and the symbol layer's, which `flowFieldConfigurator.tsx` itself
 * imports — keeping this there made the two files import each other.
 */
export interface SelectKnobProps {
  layer: {
    config: { visConfig: Record<string, unknown> };
    /** Each entry is the definition the layer registered for that knob. */
    visConfigSettings: Record<string, Record<string, unknown>>;
  };
  visConfiguratorProps: Record<string, unknown>;
  property: string;
  /**
   * Narrows the registered list when a mode makes some of the options
   * meaningless, rather than offering a knob that does nothing.
   */
  options?: string[];
  /**
   * How an option reads, when it is not a message id.
   *
   * For a list that is its own words — the symbol layer's glyph names, several
   * hundred of them, which have no messages on purpose. Translating those would
   * render each as its raw id and raise a missing-translation error per option.
   */
  displayOption?: (option: string) => string;
  /** Offers a search box over the options; for a list too long to scroll. */
  searchable?: boolean;
}

export function SelectKnob({
  layer,
  visConfiguratorProps,
  property,
  options,
  displayOption,
  searchable = false,
}: SelectKnobProps) {
  const intl = useIntl();
  const setting = layer.visConfigSettings[property] as
    { options?: string[]; defaultValue?: string; label?: string } | undefined;
  const choices = options ?? setting?.options;

  if (!setting?.label || !choices) {
    return null;
  }

  const label = setting.label;
  const onChange = visConfiguratorProps.onChange as (patch: Record<string, unknown>) => void;
  const chosen = layer.config.visConfig[property] as string | undefined;

  return (
    <SidePanelSection>
      <PanelLabel>{intl.formatMessage({ id: label })}</PanelLabel>
      <ItemSelector
        selectedItems={chosen && choices.includes(chosen) ? chosen : choices[0]}
        options={choices}
        multiSelect={false}
        searchable={searchable}
        getOptionValue={(option: string) => option}
        displayOption={displayOption ?? ((option: string) => intl.formatMessage({ id: `${label}.${option}` }))}
        // `ItemSelector` types its handler for the multi-select case too; ours
        // is single-select over strings, and anything else is not an answer.
        onChange={(value) => {
          if (typeof value === 'string') {
            onChange({ [property]: value });
          }
        }}
      />
    </SidePanelSection>
  );
}
