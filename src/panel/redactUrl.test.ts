import { describeError, redactUrl, redactUrlsIn } from './redactUrl';

describe('redactUrl', () => {
  it('drops the user, password, query and fragment', () => {
    expect(redactUrl('https://ana:s3cret@example.com/places.json?token=abc#k=1')).toBe(
      'https://example.com/places.json?…'
    );
  });

  it('keeps the origin and path of a URL with nothing to hide', () => {
    expect(redactUrl('https://example.com:8443/models/site.glb')).toBe('https://example.com:8443/models/site.glb');
  });

  it('keeps a relative path and hides its query', () => {
    expect(redactUrl('/public/plugins/p/models/site-4d.glb?v=2')).toBe('/public/plugins/p/models/site-4d.glb?…');
  });

  it('names a data or blob URL without its contents', () => {
    expect(redactUrl('data:image/png;base64,AAAA')).toBe('data:…');
    expect(redactUrl('blob:https://example.com/1234')).toBe('blob:…');
  });
});

describe('redactUrlsIn', () => {
  it('redacts every URL in a message', () => {
    expect(redactUrlsIn('GET https://u:p@a.example/x?key=1 failed, then wss://b.example/y?t=2')).toBe(
      'GET https://a.example/x?… failed, then wss://b.example/y?…'
    );
  });
});

describe('describeError', () => {
  it('gives the name and the redacted message of an Error', () => {
    expect(describeError(new TypeError('could not load https://u:p@a.example/m.glb?sig=z'))).toBe(
      'TypeError: could not load https://a.example/m.glb?…'
    );
  });

  it('keeps only the status and message of a failed Grafana request, never its config', () => {
    const failed = {
      status: 401,
      statusText: 'Unauthorized',
      data: { message: 'invalid API key' },
      config: { url: 'https://api.example/hook?token=abc', headers: { Authorization: 'Bearer abc' } },
    };
    const text = describeError(failed);
    expect(text).toBe('401 Unauthorized invalid API key');
    expect(text).not.toContain('abc');
  });
});
