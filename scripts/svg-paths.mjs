/**
 * Pure helpers the icon vendoring scripts share: reading one icon's SVG into
 * the plain paths the symbol layer paints with `Path2D`, and nothing else.
 *
 * Kept apart from the scripts so they can be tested without a network or a
 * checkout of the icon libraries (`npm run test:scripts`). Anything a reader
 * does not understand throws: a shape dropped silently is a blank cell on
 * someone's map.
 */

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/** Formats a number for path data: at most `decimals` places, no `-0`. */
function format(value, decimals) {
  const rounded = Number(value.toFixed(decimals));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Throws on an arc whose flags run into their neighbours (`A5 5 0 0110 10`).
 *
 * SVG lets the two one-digit flags of an arc touch the next number, and the
 * rounding below would read `0110` as the number 110. Neither library writes
 * them that way today; this is what says so if one starts.
 */
function assertSeparateArcFlags(d) {
  // Every command letter but `e`, which belongs to a number's exponent.
  for (const [, args] of d.matchAll(/[Aa]([^A-DF-Za-df-z]*)/g)) {
    const numbers = args.match(NUMBER) ?? [];
    const flagsAreBits = numbers.every((n, i) => i % 7 < 3 || i % 7 > 4 || n === '0' || n === '1');
    if (numbers.length % 7 !== 0 || !flagsAreBits) {
      throw new Error(`Arc flags run into their neighbours in "A${args.trim()}"`);
    }
  }
}

/**
 * Rounds every number in path data to `decimals` places.
 *
 * SVG lets two numbers touch when the second starts with `.` or `-`
 * (`-.43.98` is two numbers). Rounding can give the second a leading `0`, which
 * would glue it to the first, so a space goes in wherever a number follows a
 * digit or a point.
 */
export function roundNumbers(d, decimals = 2) {
  assertSeparateArcFlags(d);
  return d.replace(NUMBER, (match, offset, whole) => {
    const before = offset > 0 ? whole[offset - 1] : '';
    const text = format(Number(match), decimals);
    return /[\d.]/.test(before) ? ` ${text}` : text;
  });
}

/** A circle as two half-circle arcs. */
export function circlePath(cx, cy, r) {
  return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
}

/** A rectangle, with its corners rounded when `rx` (and `ry`) are given. */
export function rectPath(x, y, w, h, rx = 0, ry = rx) {
  const cx = Math.min(rx, w / 2);
  const cy = Math.min(ry, h / 2);
  if (cx <= 0 || cy <= 0) {
    return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  }
  const arc = `A${cx} ${cy} 0 0 1`;
  return (
    `M${x + cx} ${y}H${x + w - cx}${arc} ${x + w} ${y + cy}` +
    `V${y + h - cy}${arc} ${x + w - cx} ${y + h}` +
    `H${x + cx}${arc} ${x} ${y + h - cy}` +
    `V${y + cy}${arc} ${x + cx} ${y}Z`
  );
}

/** A polygon's `points` as a closed path. */
export function polygonPath(points) {
  const values = (points.match(NUMBER) ?? []).map(Number);
  if (values.length < 6 || values.length % 2 !== 0) {
    throw new Error(`A polygon needs at least three x,y pairs, got "${points}"`);
  }
  const pairs = [];
  for (let i = 0; i < values.length; i += 2) {
    pairs.push(`${values[i]} ${values[i + 1]}`);
  }
  return `M${pairs.join('L')}Z`;
}

/**
 * The square an icon is drawn in, and where its `viewBox` sits inside it.
 *
 * `side` is the longer side of the view box. `margin` of it is added all round,
 * so a tightly cropped icon does not fill its atlas cell edge to edge, and the
 * shorter side is centred. Both come back rounded to two places.
 */
export function centredBox([minX, minY, width, height], margin = 0.07) {
  const side = Math.max(width, height);
  const pad = side * margin;
  const round = (value) => Number(format(value, 2));
  return {
    box: round(side + 2 * pad),
    offset: [round(pad + (side - width) / 2 - minX), round(pad + (side - height) / 2 - minY)],
  };
}

/** The attributes of one start tag, by name. */
export function attributes(tag) {
  const found = {};
  for (const [, name, value] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    found[name] = value;
  }
  return found;
}

function viewBoxOf(svg) {
  const open = svg.match(/<svg\b[^>]*>/);
  const box = open ? attributes(open[0]).viewBox : undefined;
  const values = box
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!values || values.length !== 4 || values.some((v) => !Number.isFinite(v))) {
    throw new Error(`No usable viewBox: ${open?.[0] ?? '(no <svg> tag)'}`);
  }
  return values;
}

const BLACK = /^(#000|#000000|black)$/i;
const NEVER =
  /<(use|image|text|line|polyline|ellipse|linearGradient|radialGradient|mask|clipPath|pattern)\b|\stransform\s*=/;

/**
 * Attributes and CSS properties `readOchaSvg` refuses wherever they appear:
 * each hides part of a shape in a way `PathGlyph`'s plain, opaque fill cannot
 * carry, so a shape drawn with one of these would come out solid where the
 * source meant it translucent, clipped or masked.
 */
const UNSUPPORTED_ATTRS = ['opacity', 'fill-opacity', 'clip-path', 'mask'];

/**
 * One of Temaki's icons: `<path>` elements only, filled with the colour the
 * map gives them.
 *
 * Most are drawn in a 15 or 50 unit square, but a few are not square at all
 * (`latrine` is 22 by 48), so the box comes from `centredBox` with no margin:
 * Temaki's grid already leaves the air Maki's does.
 */
export function readTemakiSvg(svg) {
  const viewBox = viewBoxOf(svg);
  if (NEVER.test(svg) || /<(circle|rect|polygon|g)\b/.test(svg) || /\sstroke(-width)?\s*=/.test(svg)) {
    throw new Error('Expected <path> elements only, with no transform or stroke');
  }
  const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => {
    const attrs = attributes(tag);
    // Allowlisted, not blocklisted: an attribute this reader has never seen —
    // `fill-opacity`, `class`, `id`… — throws rather than being silently
    // carried past a glyph model that has nowhere to put it.
    for (const name of Object.keys(attrs)) {
      if (name === 'd') {
        continue;
      }
      if (name === 'fill') {
        if (!BLACK.test(attrs.fill)) {
          throw new Error(`Unexpected fill "${attrs.fill}"`);
        }
        continue;
      }
      throw new Error(`Unexpected attribute "${name}" on <path>`);
    }
    if (!attrs.d) {
      throw new Error(`A <path> without d: ${tag}`);
    }
    return { d: attrs.d.replace(/\s+/g, ' ').trim() };
  });
  if (paths.length === 0) {
    throw new Error('No <path> in the icon');
  }
  return { ...centredBox(viewBox, 0), paths };
}

/**
 * The classes an OCHA icon's stylesheet fills with `evenodd`, after checking
 * that it only ever fills black and never strokes.
 */
function evenOddClasses(svg) {
  const css = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const classes = new Set();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    for (const declaration of body.split(';')) {
      const [property, value] = declaration.split(':').map((part) => part?.trim());
      if (!property) {
        continue;
      }
      if (property === 'fill' && !BLACK.test(value)) {
        throw new Error(`Unexpected fill "${value}"`);
      }
      if (property === 'stroke' || (property === 'stroke-width' && !/^0(px)?$/.test(value))) {
        throw new Error(`Unexpected ${property} "${value}"`);
      }
      if (property === 'opacity' || property === 'fill-opacity') {
        throw new Error(`Unexpected ${property} "${value}" in <style>`);
      }
      if (property === 'fill-rule' && value === 'evenodd') {
        for (const selector of selectors.split(',')) {
          classes.add(selector.trim().replace(/^\./, ''));
        }
      }
    }
  }
  return classes;
}

/**
 * One of OCHA's icons: Illustrator's output, with a stylesheet, groups and the
 * odd circle, rectangle or polygon among the paths.
 *
 * Returns the paths in document order with the view box they were drawn in;
 * `centredBox` turns that into the square the atlas needs.
 */
export function readOchaSvg(svg) {
  const viewBox = viewBoxOf(svg);
  const evenOdd = evenOddClasses(svg);
  const body = svg.replace(/<(style|title|defs)\b[\s\S]*?<\/\1>/g, '');
  if (NEVER.test(body)) {
    throw new Error('Unsupported element or transform');
  }
  // `<g>` is otherwise allowed (icons group their shapes), but not carrying
  // one of these: `NEVER` above only catches a transform, and a group's own
  // opacity, clip or mask attribute would hide part of the icon just as
  // invisibly as one on a shape itself.
  for (const [tag] of body.matchAll(/<g\b[^>]*>/g)) {
    const attrs = attributes(tag);
    for (const name of UNSUPPORTED_ATTRS) {
      if (attrs[name] !== undefined) {
        throw new Error(`Unexpected ${name} on <g>`);
      }
    }
  }
  const paths = [];
  for (const [tag, name] of body.matchAll(/<(path|circle|rect|polygon)\b[^>]*>/g)) {
    const attrs = attributes(tag);
    if (attrs.style !== undefined || (attrs.fill !== undefined && !BLACK.test(attrs.fill))) {
      throw new Error(`Unexpected inline style or fill: ${tag}`);
    }
    for (const unsupported of UNSUPPORTED_ATTRS) {
      if (attrs[unsupported] !== undefined) {
        throw new Error(`Unexpected ${unsupported} on <${name}>`);
      }
    }
    const number = (key, fallback) => {
      const value = attrs[key] === undefined ? fallback : Number(attrs[key]);
      if (!Number.isFinite(value)) {
        throw new Error(`Missing or bad ${key} in ${tag}`);
      }
      return value;
    };
    let d;
    if (name === 'path') {
      d = attrs.d;
    } else if (name === 'circle') {
      d = circlePath(number('cx', 0), number('cy', 0), number('r'));
    } else if (name === 'rect') {
      // SVG takes a missing radius from the other one.
      const rx = attrs.rx ?? attrs.ry;
      const ry = attrs.ry ?? attrs.rx;
      d = rectPath(
        number('x', 0),
        number('y', 0),
        number('width'),
        number('height'),
        rx === undefined ? 0 : Number(rx),
        ry === undefined ? 0 : Number(ry)
      );
    } else {
      d = polygonPath(attrs.points ?? '');
    }
    if (!d) {
      throw new Error(`A shape without geometry: ${tag}`);
    }
    const classes = (attrs.class ?? '').split(/\s+/).filter(Boolean);
    const path = { d: roundNumbers(d.replace(/\s+/g, ' ').trim()) };
    paths.push(
      attrs['fill-rule'] === 'evenodd' || classes.some((c) => evenOdd.has(c)) ? { ...path, evenOdd: true } : path
    );
  }
  if (paths.length === 0) {
    throw new Error('No shape in the icon');
  }
  return { viewBox, paths };
}

/**
 * The name an OCHA file gets in the catalogue, after `ocha:`: lower case, with
 * spaces as hyphens. `ochaKey` in `src/panel/symbolGlyphs.ts` applies the same
 * rule at run time, so change both or neither.
 */
export function ochaSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '-');
}
