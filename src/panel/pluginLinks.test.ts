import { chaskiExtensionPoint, chaskiLinkOf, timeWindowExtensionPoint, timeWindowLinkOf } from './pluginLinks';

describe('the plugin links', () => {
  it('name extension points under the plugin that asks', () => {
    expect(chaskiExtensionPoint('ubica-keplergl-panel')).toBe('ubica-keplergl-panel/chaski/v1');
    expect(timeWindowExtensionPoint('ubica-keplerplus-panel')).toBe('ubica-keplerplus-panel/time-window/v1');
  });

  it('take a Chaski link of version 1 only', () => {
    const api = { apiVersion: 1, subscribeActivity: () => () => undefined, mosaicRuntime: () => Promise.resolve({}) };
    expect(chaskiLinkOf(api)).not.toBeNull();
    expect(chaskiLinkOf({ ...api, apiVersion: 2 })).toBeNull();
    expect(chaskiLinkOf({ ...api, mosaicRuntime: 'no' })).toBeNull();
    expect(chaskiLinkOf(undefined)).toBeNull();
  });

  it('take a time window link of version 1 only', () => {
    const api = { apiVersion: 1, say: () => undefined, subscribe: () => () => undefined };
    expect(timeWindowLinkOf(api)).not.toBeNull();
    expect(timeWindowLinkOf({ ...api, apiVersion: undefined })).toBeNull();
    expect(timeWindowLinkOf({ ...api, subscribe: null })).toBeNull();
    expect(timeWindowLinkOf(null)).toBeNull();
  });
});
