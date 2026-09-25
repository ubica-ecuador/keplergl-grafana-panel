import { test, expect } from '@grafana/plugin-e2e';

/**
 * The trip playhead reaches the dashboard as a variable: once on load, as it
 * plays, and where it stops. The provisioned map writes it to `$playhead` every
 * 250 ms, with its time sync off: this clock does not depend on that option.
 */

/**
 * kepler's trip animation control, the one at the bottom of the map: its
 * first playback button is play/pause. Scoped to `.animation-control-container`
 * because `.playback-control-button` alone also matches the Filters tab's own
 * time-range-slider playback, which lives under `.time-range-slider__container`
 * instead.
 */
const PLAY = '.animation-control-container .playback-control-button';

function playhead(url: string): string | null {
  return new URL(url).searchParams.get('var-playhead');
}

test('the playback interval shows when a playhead variable is set, with time sync off', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'playhead.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const map = panelEditPage.getCustomOptions('Map');
  if (!(await map.isExpanded())) {
    await map.expand();
  }
  await expect(map.getNumberInput('Minimum interval while playing (ms)')).toHaveValue('250');
});

test('the map writes its trip playhead on load, while playing, and where it stops', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'playhead.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId('data-testid Panel header Kepler.gl — playhead');
  await expect(panel.locator('.maplibregl-map')).toBeVisible({ timeout: 60_000 });

  // On load: the start of the trips, before anyone presses play.
  await expect.poll(() => playhead(page.url()), { timeout: 30_000 }).toMatch(/^2025-07-23T08:/);
  const onLoad = playhead(page.url());

  const play = panel.locator(PLAY).first();
  await expect(play).toBeVisible({ timeout: 60_000 });
  await play.click();

  // Playing: at least two more distinct instants, each later than the one before.
  const seen = new Set<string>([onLoad ?? '']);
  await expect
    .poll(
      () => {
        const value = playhead(page.url());
        if (value) {
          seen.add(value);
        }
        return seen.size;
      },
      { timeout: 20_000 }
    )
    .toBeGreaterThanOrEqual(3);
  const ordered = [...seen].filter(Boolean).sort();
  expect(ordered[0]).toBe(onLoad);

  // The text panel reads the same variable.
  await expect(page.getByTestId('data-testid Panel header Playhead')).toContainText('2025-07-23T');

  // Stopped: the value stays where it stopped.
  await play.click();
  await page.waitForTimeout(1000);
  const stoppedAt = playhead(page.url());
  await page.waitForTimeout(2000);
  expect(playhead(page.url())).toBe(stoppedAt);
});
