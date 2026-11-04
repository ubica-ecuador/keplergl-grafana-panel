/**
 * Geomap's GeoJSON style rules, as one kepler colour channel.
 *
 * Geomap styles each feature with the first rule whose check it passes, and the
 * layer's own style when none does. kepler colours a layer by one field through
 * one scale, so the rules carry over when they all look at the same property:
 *
 * - every rule an equality: a colour per value (kepler's `customOrdinal`), the
 *   default style's colour for every other value;
 * - every rule a comparison of numbers: the number line cut at the rules'
 *   values, each stretch taking the colour the rule list gives a value inside it
 *   (kepler's `custom` breaks). Where a rule says `gt` and another `gte` at the
 *   same value, the boundary point itself may fall on either side.
 *
 * Anything else (rules on two properties, equalities mixed with comparisons) has
 * no single-channel equivalent and is left out, with the default style kept.
 */

export interface GeomapRule {
  check?: { property?: string; operation?: string; value?: string | number | boolean };
  /** The rule's colour, already resolved to hex. */
  color: string;
}

export interface RuleColors {
  property: string;
  scale: 'customOrdinal' | 'custom';
  colors: string[];
  colorMap: Array<[string | number | null, string]>;
}

const COMPARISONS = new Set(['gt', 'gte', 'lt', 'lte']);

export function rulesToColors(rules: GeomapRule[], defaultColor: string): RuleColors | null {
  const checked = rules.filter((r) => r.check?.property && r.check.operation && r.check.value !== undefined);
  if (!checked.length) {
    return null;
  }
  const property = checked[0].check!.property!;
  if (checked.some((r) => r.check!.property !== property)) {
    return null;
  }

  if (checked.every((r) => r.check!.operation === 'eq')) {
    const colorMap: Array<[string | number | null, string]> = [];
    for (const rule of checked) {
      const value = rule.check!.value as string | number;
      // The first rule for a value wins, as in Geomap.
      if (!colorMap.some(([v]) => v === value)) {
        colorMap.push([value, rule.color]);
      }
    }
    return { property, scale: 'customOrdinal', colors: [...colorMap.map(([, c]) => c), defaultColor], colorMap };
  }

  if (checked.every((r) => COMPARISONS.has(r.check!.operation!) && isNumber(r.check!.value))) {
    const cuts = [...new Set(checked.map((r) => Number(r.check!.value)))].sort((a, b) => a - b);
    // One sample inside each stretch: below the first cut, between two, above the last.
    const samples = [cuts[0] - 1, ...cuts.slice(1).map((cut, i) => (cuts[i] + cut) / 2), cuts[cuts.length - 1] + 1];
    const colors = samples.map((sample) => firstMatch(checked, sample) ?? defaultColor);
    const colorMap = colors.map((color, i): [number | null, string] => [i < cuts.length ? cuts[i] : null, color]);
    return { property, scale: 'custom', colors, colorMap };
  }

  return null;
}

function firstMatch(rules: GeomapRule[], value: number): string | undefined {
  for (const rule of rules) {
    const threshold = Number(rule.check!.value);
    const passes =
      (rule.check!.operation === 'gt' && value > threshold) ||
      (rule.check!.operation === 'gte' && value >= threshold) ||
      (rule.check!.operation === 'lt' && value < threshold) ||
      (rule.check!.operation === 'lte' && value <= threshold);
    if (passes) {
      return rule.color;
    }
  }
  return undefined;
}

function isNumber(value: unknown): boolean {
  return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value)));
}
