import React, { useEffect, useRef } from 'react';
import { dropdownListClassList } from '@kepler.gl/components';

import { CELL } from './vectorFieldGlyphs';
import { glyphsFor, paintGlyphs, SymbolPainter } from './symbolGlyphs';

/** The side of a shape's drawing in the list, in CSS pixels. */
const PREVIEW_PX = 16;

/**
 * A shape in the shape picker: its drawing, then its name.
 *
 * Drawn by the same painter the map's atlas uses, so what is picked is what is
 * drawn — not a second rendering of the same geometry that could disagree with
 * it. A canvas rather than an image, for the reason the atlas is one: Grafana's
 * strict CSP.
 *
 * kepler renders the chosen value with this same component, so the picker shows
 * the shape in use before it is opened.
 */
export function SymbolOption({
  value,
  displayOption,
  disabled,
}: {
  value: string;
  displayOption: (option: string) => string;
  disabled?: boolean;
}) {
  const name = displayOption(value);
  return (
    <span
      title={name}
      className={`${dropdownListClassList.listItemAnchor}${disabled ? ' disabled' : ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      <GlyphPreview name={value} />
      {name}
    </span>
  );
}

function GlyphPreview({ name }: { name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    // jsdom, or a browser out of 2D contexts: the name alone still reads.
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    const scale = (PREVIEW_PX * (window.devicePixelRatio || 1)) / CELL;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);
    // Painted white, like the atlas, then tinted to the text beside it, so the
    // drawing follows the panel's theme.
    paintGlyphs(glyphsFor([name]), ctx as unknown as SymbolPainter, 1);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = getComputedStyle(canvas).color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }, [name]);

  const side = Math.round(PREVIEW_PX * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  return (
    <canvas
      ref={ref}
      data-symbol={name}
      width={side}
      height={side}
      style={{ width: PREVIEW_PX, height: PREVIEW_PX, flex: 'none' }}
      aria-hidden
    />
  );
}
