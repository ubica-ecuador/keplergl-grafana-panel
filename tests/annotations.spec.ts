import { test, expect } from '@grafana/plugin-e2e';
import type { APIRequestContext, Locator, Page, Request } from '@playwright/test';

/**
 * Grafana annotations on the map, and map notes into Grafana
 * (`annotations.json`: a map on Show and save over a time chart).
 *
 * What these pin: an annotation with a `geo:` tag is drawn on the map; a note
 * put down on the map is saved as a Grafana annotation with its place, and the
 * panel then leaves the dashboard alone: it presses no button of Grafana's and
 * re-runs no query, and the time chart draws the note at the dashboard's next
 * refresh.
 */

const NOTES_PANEL = 'Notes';

async function gotoNotes(
  gotoDashboardPage: (args: { uid: string }) => Promise<unknown>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page
): Promise<{ map: Locator; uid: string }> {
  const dashboard = await readProvisionedDashboard({ fileName: 'annotations.json' });
  await gotoDashboardPage(dashboard);
  const map = page.getByTestId(`data-testid Panel header ${NOTES_PANEL}`).locator('.maplibregl-map, canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  return { map, uid: dashboard.uid };
}

/** Runs `body` with the map's kepler store and instance id, found through React from the map node. */
async function withStore<T, A>(map: Locator, body: string, arg: A): Promise<T> {
  return map.evaluate(
    (node, [source, input]) => {
      const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
      let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
      let store: any = null;
      while (fiber) {
        const candidate = fiber.memoizedProps && fiber.memoizedProps.store;
        if (candidate && typeof candidate.getState === 'function') {
          store = candidate;
          break;
        }
        fiber = fiber.return;
      }
      if (!store) {
        throw new Error('kepler store not found from map node');
      }
      const instanceId = Object.keys(store.getState().keplerGl ?? {})[0];
      const forward = (action: Record<string, unknown>) =>
        store.dispatch({
          type: action.type,
          payload: { ...action, meta: { _id_: instanceId } },
          meta: { _forward_: '@redux-forward/FORWARD', _addr_: `@@KG_${instanceId.toUpperCase()}` },
        });
      // eslint-disable-next-line no-new-func
      return new Function('store', 'instanceId', 'forward', 'input', source)(store, instanceId, forward, input);
    },
    [body, arg] as const
  ) as Promise<T>;
}

const noteIds = (map: Locator) =>
  withStore<string[], null>(
    map,
    'return (store.getState().keplerGl[instanceId].visState.annotations || []).map((a) => a.id);',
    null
  );

async function deleteAnnotation(request: APIRequestContext, id: number): Promise<void> {
  await request.delete(`/api/annotations/${id}`);
}

test('an annotation with a place is drawn on the map', async ({
  page,
  gotoDashboardPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'annotations.json' });
  const created = await page.request.post('/api/annotations', {
    data: {
      dashboardUID: dashboard.uid,
      time: Date.now() - 30 * 60_000,
      tags: ['geo:-79.004,-2.9'],
      text: 'e2e: an annotation with a place',
    },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: number };
  try {
    const { map } = await gotoNotes(gotoDashboardPage, readProvisionedDashboard, page);
    await expect.poll(() => noteIds(map), { timeout: 60_000 }).toContain(`grafana-${id}`);
  } finally {
    await deleteAnnotation(page.request, id);
  }
});

test('a note put down on the map is saved as an annotation, and the dashboard is left alone', async ({
  page,
  gotoDashboardPage,
  readProvisionedDashboard,
}) => {
  test.slow();
  const { map, uid } = await gotoNotes(gotoDashboardPage, readProvisionedDashboard, page);
  // The panel has drawn and its queries have answered.
  await expect.poll(() => noteIds(map).then(() => true), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(3000);

  const after: Request[] = [];
  let recording = false;
  // A query any panel runs, or the dashboard's annotation layer read again.
  page.on('request', (request) => {
    const url = request.url();
    if (recording && (/\/api\/ds\/query/.test(url) || (/\/api\/annotations/.test(url) && request.method() === 'GET'))) {
      after.push(request);
    }
  });
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/annotations') && response.request().method() === 'POST'
  );

  // What right-click → Add Annotation and a click on the bare map do: kepler
  // adds the note selected, with its text editor open, and putting it down
  // deselects it. Two steps, as a user takes them: the panel writes a note
  // when it sees its editing end.
  await withStore(map, "forward({ type: '@@kepler.gl/ADD_ANNOTATION', config: input });", {
    id: 'e2e-note',
    kind: 'POINT',
    anchorPoint: [-79.0, -2.9],
    label: 'e2e: put down on the map',
    isVisible: true,
  });
  await expect.poll(() => noteIds(map)).toContain('e2e-note');
  await page.waitForTimeout(500);
  await withStore(
    map,
    "forward({ type: '@@kepler.gl/SET_SELECTED_ANNOTATION', id: null, isEditingText: false });",
    null
  );
  const response = await saved;
  recording = true;
  expect(response.ok()).toBe(true);
  const { id } = (await response.json()) as { id: number };
  try {
    const stored = await page.request.get(`/api/annotations?dashboardUID=${uid}&limit=100`);
    const mine = ((await stored.json()) as Array<{ id: number; tags: string[]; panelId?: number }>).find(
      (a) => a.id === id
    );
    expect(mine?.tags).toEqual(expect.arrayContaining(['map']));
    expect(mine?.tags.some((t) => t.startsWith('geo:'))).toBe(true);
    // No panel: the note belongs to every time chart of the dashboard.
    expect(mine?.panelId ?? 0).toBe(0);
    // The map holds it under its Grafana id.
    await expect.poll(() => noteIds(map), { timeout: 10_000 }).toContain(`grafana-${id}`);

    // Nothing pressed Grafana's refresh button: no query and no annotation
    // layer ran again after the save.
    await page.waitForTimeout(4000);
    expect(after.map((r) => r.url())).toEqual([]);

    // The dashboard's own refresh brings it to the time chart, and the map keeps it.
    const layer = page.waitForRequest((r) => /\/api\/(annotations|ds\/query)/.test(r.url()));
    await page.getByTestId('data-testid RefreshPicker run button').click();
    await layer;
    await page.waitForTimeout(2000);
    expect(await noteIds(map)).toContain(`grafana-${id}`);
  } finally {
    await deleteAnnotation(page.request, id);
  }
});
