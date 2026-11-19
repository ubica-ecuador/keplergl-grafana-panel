import { xyzTileUrl } from './xyzTiles';
import { xyzDeckProps } from '../panel/xyzTileLayer';

describe('XYZ tiles', () => {
  it('fills a tile template, south-up rows and subdomains included', () => {
    const tile = { x: 3, y: 1, z: 2 };
    expect(xyzTileUrl('https://t.example.org/{z}/{x}/{y}.png', tile)).toBe('https://t.example.org/2/3/1.png');
    expect(xyzTileUrl('https://t.example.org/{z}/{x}/{-y}.png', tile)).toBe('https://t.example.org/2/3/2.png');
    expect(xyzTileUrl('https://{s}.t.example.org/{z}/{x}/{y}.png', tile)).toBe('https://a.t.example.org/2/3/1.png');
    expect(xyzTileUrl('https://{a-c}.t.example.org/{z}/{y}/{x}', tile)).toBe('https://a.t.example.org/2/1/3');
  });

  it('asks deck for tiles only with a template, refetching when it changes', () => {
    expect(xyzDeckProps({ id: 'l', metadata: { url: ' ' } })).toBeNull();
    const props = xyzDeckProps({ id: 'l', metadata: { url: 'https://t/{z}/{x}/{y}', maxZoom: 9 }, opacity: 0.5 })!;
    expect(props).toMatchObject({ opacity: 0.5, maxZoom: 9, updateTriggers: { getTileData: 'https://t/{z}/{x}/{y}' } });
    expect((props.getTileUrl as (i: object) => string)({ x: 1, y: 2, z: 3 })).toBe('https://t/3/1/2');
  });

  it("puts a level's own name where {z} is, and offers MapLibre no template it could not fill", () => {
    const props = xyzDeckProps({ id: 'l', metadata: { url: 'https://t/{z}/{x}/{y}', zoomIds: { '3': '03' } } })!;
    expect((props.getTileUrl as (i: object) => string)({ x: 1, y: 2, z: 3 })).toBe('https://t/03/1/2');
    expect(props).not.toHaveProperty('reliefTiles');
    expect(xyzTileUrl('https://t/{z}', { x: 0, y: 0, z: 4 }, { '3': '03' })).toBe('https://t/4');
  });
});
