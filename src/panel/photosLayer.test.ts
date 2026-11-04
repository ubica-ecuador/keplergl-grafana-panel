import { photoAccessor } from './photosLayer';

const dataset = {
  fields: [{ name: 'name' }, { name: 'photo' }],
  dataContainer: {
    valueAt: (row: number, column: number) =>
      [
        ['Quito', 'https://x/q.png'],
        ['Loja', ''],
      ][row][column],
  },
};

describe('photoAccessor', () => {
  it('reads each row’s picture from the named column, and nothing where it is empty', () => {
    const photo = photoAccessor(dataset, 'photo');
    expect(photo({ index: 0 })).toBe('https://x/q.png');
    expect(photo({ index: 1 })).toBeNull();
  });

  it('gives nothing when the column is not there', () => {
    expect(photoAccessor(dataset, 'missing')({ index: 0 })).toBeNull();
    expect(photoAccessor(undefined, 'photo')({ index: 0 })).toBeNull();
  });
});
