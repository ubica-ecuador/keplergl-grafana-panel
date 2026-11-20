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

  it('puts the service’s own name for a level in {z}, and its number where it names none', () => {
    const ids = { 8: '08', 9: 'EPSG:3857:9' };
    expect(xyzTileUrl('https://t/{z}/{x}/{y}.png', { x: 1, y: 2, z: 8 }, ids)).toBe('https://t/08/1/2.png');
    expect(xyzTileUrl('https://t/{z}/{x}/{y}.png', { x: 1, y: 2, z: 9 }, ids)).toBe('https://t/EPSG:3857:9/1/2.png');
    expect(xyzTileUrl('https://t/{z}/{x}/{y}.png', { x: 1, y: 2, z: 10 }, ids)).toBe('https://t/10/1/2.png');
    // South-up rows count from the level's number, not its name.
    expect(xyzTileUrl('https://t/{z}/{x}/{-y}.png', { x: 1, y: 2, z: 2 }, { 2: '02' })).toBe('https://t/02/1/1.png');
  });

  it('asks deck by the levels’ names, and hands MapLibre no template it would fill with numbers', () => {
    const plain = xyzDeckProps({ id: 'l', metadata: { url: 'https://t/{z}/{x}/{y}' } })!;
    expect(plain.reliefTiles).toBe('https://t/{z}/{x}/{y}');

    const named = xyzDeckProps({ id: 'l', metadata: { url: 'https://t/{z}/{x}/{y}', zoomIds: { 3: '03' } } })!;
    expect((named.getTileUrl as (i: object) => string)({ x: 1, y: 2, z: 3 })).toBe('https://t/03/1/2');
    expect(named).not.toHaveProperty('reliefTiles');
    expect(named.updateTriggers).toEqual({ getTileData: 'https://t/{z}/{x}/{y} {"3":"03"}' });
  });
});
