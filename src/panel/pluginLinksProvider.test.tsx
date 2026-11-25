import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { PluginContextProvider, type PluginMeta, usePluginContext } from '@grafana/data';
import { setPluginFunctionsHook } from '@grafana/runtime';

import { PluginLinks, useChaskiLink, useTimeWindowLink } from './pluginLinks';

const chaskiApi = { apiVersion: 1, subscribeActivity: () => () => undefined, mosaicRuntime: () => Promise.resolve({}) };
const asked: Array<{ id: string; listed: string[] }> = [];

/** Grafana's registry, as far as this test needs it: what it was asked, with the metadata it would check. */
function useFakeFunctions({ extensionPointId }: { extensionPointId: string }) {
  const meta = usePluginContext()?.meta;
  asked.push({ id: extensionPointId, listed: (meta?.extensions?.extensionPoints ?? []).map((p) => p.id) });
  const functions = extensionPointId.endsWith('/chaski/v1')
    ? [{ id: 'x', pluginId: 'ubica-chaski-app', title: 'kepler-link', description: '', fn: () => chaskiApi }]
    : [];
  return { isLoading: false, functions };
}

function Probe({ seen }: { seen: (links: unknown[]) => void }) {
  seen([useChaskiLink(), useTimeWindowLink()]);
  return null;
}

describe('PluginLinks', () => {
  beforeAll(() => setPluginFunctionsHook(useFakeFunctions as never));

  it("asks under the panel's id, with its extension points in the metadata Grafana checks, and hands the links down", async () => {
    // Grafana 13 gives a panel's metadata without `extensions`.
    const meta = { id: 'ubica-keplergl-panel', module: 'public/plugins/ubica-keplergl-panel/module.js' } as PluginMeta;
    let last: unknown[] = [];
    render(
      <PluginContextProvider meta={meta}>
        <PluginLinks>
          <Probe seen={(links) => (last = links)} />
        </PluginLinks>
      </PluginContextProvider>
    );
    await waitFor(() => expect(last[0]).toBeDefined());
    expect(last[1]).toBeUndefined();
    const ids = asked.map((a) => a.id);
    expect(ids).toContain('ubica-keplergl-panel/chaski/v1');
    expect(ids).toContain('ubica-keplergl-panel/time-window/v1');
    for (const { id, listed } of asked) {
      expect(listed).toContain(id);
    }
  });
});
