import type { Locator, Page } from '@playwright/test';

/**
 * Shared readers for the kepler state behind a panel, and the pointer
 * geometry to click data on a software-rendered map.
 *
 * The store is not exposed; every reader walks up the React fiber tree from
 * the map node to the redux `<Provider store>`, the same way react-redux
 * reaches it — the pattern `drawFilter.spec.ts` established.
 */

/** What the sync specs assert about a panel's kepler state. */
export interface KeplerSummary {
  /** kepler's coordinate interaction switch — the coordinate channel enables it. */
  coordEnabled: boolean;
  /** 'none' (no pin state), 'null' (unpinned) or the pinned `[lng, lat]`. */
  pinned: 'none' | 'null' | [number, number];
  /** The filters' `[type, firstName]` pairs with their values. */
  filters: Array<{ type: string; name: string; value: unknown }>;
  mapState: { latitude: number; longitude: number; zoom: number };
  layers: Array<{ id: string; type: string }>;
}

export async function readKepler(map: Locator): Promise<KeplerSummary> {
  return map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    let store = null;
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
    const entry = Object.values(store.getState().keplerGl ?? {})[0] as any;
    const visState = entry?.visState;
    const pinnedRaw = visState?.mousePos?.pinned;
    return {
      coordEnabled: Boolean(visState?.interactionConfig?.coordinate?.enabled),
      pinned:
        pinnedRaw === undefined
          ? ('none' as const)
          : pinnedRaw === null
            ? ('null' as const)
            : (pinnedRaw.coordinate as [number, number]),
      filters: (visState?.filters ?? []).map((f: { type?: string; name?: string[] | string; value?: unknown }) => ({
        type: f.type ?? 'unknown',
        name: Array.isArray(f.name) ? (f.name[0] ?? '') : (f.name ?? ''),
        value: f.value,
      })),
      mapState: {
        latitude: entry?.mapState?.latitude ?? NaN,
        longitude: entry?.mapState?.longitude ?? NaN,
        zoom: entry?.mapState?.zoom ?? NaN,
      },
      layers: (visState?.layers ?? []).map((l: { id: string; type?: string }) => ({ id: l.id, type: l.type ?? '' })),
    };
  });
}

/** A dataset row with where it sits on screen and what it holds. */
export interface ProjectedRow {
  x: number;
  y: number;
  values: Record<string, unknown>;
}

/**
 * Screen positions of the first dataset's rows, keeping only rows whose
 * pixel lands on the bare deck event surface — anything with a class name is
 * an overlay (side panel, map controls, floating widgets) that would swallow
 * the click. Plain Web Mercator around the current viewport, the same
 * arithmetic kepler uses for an untilted map.
 */
export async function projectRows(map: Locator): Promise<ProjectedRow[]> {
  return map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    let store = null;
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
    const entry = Object.values(store.getState().keplerGl ?? {})[0] as any;
    const { latitude, longitude, zoom } = entry.mapState;
    const dataset = Object.values(entry.visState.datasets ?? {})[0] as any;
    if (!dataset) {
      return [];
    }
    const fields: Array<{ name: string }> = dataset.fields;
    const latIdx = fields.findIndex((f) => f.name === 'latitude');
    const lngIdx = fields.findIndex((f) => f.name === 'longitude');
    if (latIdx < 0 || lngIdx < 0) {
      return [];
    }

    const scale = 512 * Math.pow(2, zoom);
    const project = (lng: number, lat: number): [number, number] => {
      const x = ((lng + 180) / 360) * scale;
      const s = Math.sin((lat * Math.PI) / 180);
      const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
      return [x, y];
    };
    const [cx, cy] = project(longitude, latitude);
    const rect = node.getBoundingClientRect();

    const rows: Array<{ x: number; y: number; values: Record<string, unknown> }> = [];
    for (let i = 0; i < dataset.dataContainer.numRows(); i++) {
      const [px, py] = project(dataset.dataContainer.valueAt(i, lngIdx), dataset.dataContainer.valueAt(i, latIdx));
      const x = rect.x + rect.width / 2 + (px - cx);
      const y = rect.y + rect.height / 2 + (py - cy);
      if (x < rect.x + 12 || x > rect.x + rect.width - 12 || y < rect.y + 12 || y > rect.y + rect.height - 12) {
        continue;
      }
      const el = document.elementFromPoint(x, y);
      if (!(el instanceof HTMLDivElement) || el.className !== '') {
        continue;
      }
      const values: Record<string, unknown> = {};
      fields.forEach((f, idx) => {
        values[f.name] = dataset.dataContainer.valueAt(i, idx);
      });
      rows.push({ x, y, values });
    }
    return rows;
  });
}

/**
 * A point on the bare map surface at least `clearance` pixels from every
 * projected data row — a click there picks nothing.
 */
export async function emptyPoint(map: Locator, clearance = 40): Promise<{ x: number; y: number }> {
  const rows = await projectRows(map);
  const box = await map.boundingBox();
  if (!box) {
    throw new Error('map has no bounding box');
  }
  const candidates: Array<{ x: number; y: number }> = [];
  for (const fy of [0.15, 0.3, 0.45, 0.6, 0.75]) {
    for (const fx of [0.4, 0.55, 0.7, 0.85]) {
      candidates.push({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    }
  }
  const clear = candidates.filter((p) => rows.every((r) => Math.hypot(r.x - p.x, r.y - p.y) >= clearance));
  const safe = await map.evaluate(
    (_node, points) =>
      points.filter((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el instanceof HTMLDivElement && el.className === '';
      }),
    clear
  );
  if (!safe.length) {
    throw new Error('no empty map point clear of the data and overlays');
  }
  return safe[0];
}

/**
 * Waits until the page has actually processed queued input — an in-page
 * round trip through a frame, which cannot resolve before the event loop
 * turned. `waitForTimeout` alone proves nothing under software WebGL.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await page.waitForTimeout(300);
}

/** The `var-<name>` value the URL currently carries, or null when absent. */
export function urlVariable(page: Page, name: string): string | null {
  const query = page.url().split('?')[1] ?? '';
  const match = query.match(new RegExp(`var-${name}=([^&]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
