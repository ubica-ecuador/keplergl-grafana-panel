// jest cannot load MapLibre's ES-module-only build, and these tests need only
// the URL the panel hands it.
jest.mock('maplibre-gl', () => ({ setWorkerUrl: jest.fn() }), { virtual: true });

import { maplibreWorkerSource } from './maplibreWorker';

const CDN_WORKER =
  'https://plugins-cdn.grafana.net/ubica-keplerplus-app/1.4.1/public/plugins/ubica-keplerplus-app/panel/maplibre/maplibre-gl-worker.mjs';

// jsdom's Blob has no text().
const textOf = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

describe('the URL MapLibre starts its workers from', () => {
  const created: Blob[] = [];
  beforeAll(() => {
    URL.createObjectURL = jest.fn((blob: Blob) => {
      created.push(blob);
      return `blob:https://stack.grafana.net/${created.length}`;
    });
  });

  it('is the worker itself when the plugin is served from the page origin', () => {
    const local = 'https://pacha.ubica.dev/public/plugins/ubica-keplergl-panel/maplibre/maplibre-gl-worker.mjs';
    expect(maplibreWorkerSource(local, 'https://pacha.ubica.dev')).toBe(local);
    expect(created).toHaveLength(0);
  });

  it('is a same-origin blob module importing the worker when a CDN serves the plugin', async () => {
    const source = maplibreWorkerSource(CDN_WORKER, 'https://stack.grafana.net');
    expect(source).toBe('blob:https://stack.grafana.net/1');
    expect(created[0].type).toBe('text/javascript');
    expect(await textOf(created[0])).toBe(`import ${JSON.stringify(CDN_WORKER)};`);
  });
});
