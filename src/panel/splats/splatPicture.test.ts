import { pictureOf, releasePicture } from './splatPicture';

/** A device that counts what it makes and destroys. */
function fakeDevice() {
  const made: string[] = [];
  const destroyed: string[] = [];
  const resource = (id: string) => {
    made.push(id);
    return { id, destroy: () => destroyed.push(id) };
  };
  return {
    made,
    destroyed,
    createTexture: (props: { id: string }) => resource(props.id),
    createFramebuffer: (props: { id: string }) => resource(props.id),
  };
}

describe("a group's picture", () => {
  it('is made once per group and size, again when the map is resized, and dropped with its group', () => {
    const device = fakeDevice();
    const a = pictureOf(device, 'tiles-splats', 800, 600);
    expect(pictureOf(device, 'tiles-splats', 800, 600)).toBe(a);
    expect(device.made).toHaveLength(3);
    const other = pictureOf(device, 'scan', 800, 600);
    expect(other).not.toBe(a);
    const resized = pictureOf(device, 'tiles-splats', 1024, 600);
    expect(resized).not.toBe(a);
    expect(device.destroyed.sort()).toEqual(
      ['tiles-splats-picture', 'tiles-splats-picture-color', 'tiles-splats-picture-depth'].sort()
    );
    releasePicture(device, 'tiles-splats');
    expect(device.destroyed).toHaveLength(6);
    expect(pictureOf(device, 'tiles-splats', 1024, 600)).not.toBe(resized);
    // No device (a layer finalized before it had one): nothing to do.
    expect(() => releasePicture(undefined, 'scan')).not.toThrow();
  });
});
