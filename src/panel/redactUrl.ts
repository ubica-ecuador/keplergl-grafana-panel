/**
 * URLs as they may be written to the console.
 *
 * A URL a dashboard author types (a gazetteer, a picture, a model, a data
 * link) can carry credentials: a user and password before the host, a token
 * in the query or the fragment. The console is not a place for them, so a
 * warning names a URL by its origin and path only, and says that a query was
 * left out.
 */

/** Characters that end a URL inside free text: spaces, quotes and brackets. */
const URL_IN_TEXT = /\b(?:https?|wss?|s3|gs):\/\/[^\s"'<>()[\]{}`]+/gi;

/** The URL without its user, password, query and fragment; a relative path keeps its path. */
export function redactUrl(url: string): string {
  const text = String(url ?? '');
  if (/^data:/i.test(text)) {
    return 'data:…';
  }
  if (/^blob:/i.test(text)) {
    return 'blob:…';
  }
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let parsed: URL;
  try {
    parsed = new URL(text, 'http://relative.invalid');
  } catch {
    // Not a URL at all: keep nothing that could be a secret.
    return '(a URL)';
  }
  const hidden = parsed.search || parsed.hash ? '?…' : '';
  if (!absolute) {
    return `${parsed.pathname}${hidden}`;
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${hidden}`;
}

/** Text with every URL in it redacted. */
export function redactUrlsIn(text: string): string {
  return String(text ?? '').replace(URL_IN_TEXT, (match) => redactUrl(match));
}

/**
 * What a failure says, fit for the console: its name and message with any URL
 * in them redacted. Never the error object itself: a failed Grafana request
 * carries its whole request, the URL and the headers with it.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return redactUrlsIn(`${error.name}: ${error.message}`);
  }
  if (error && typeof error === 'object') {
    const { status, statusText, message, data } = error as {
      status?: unknown;
      statusText?: unknown;
      message?: unknown;
      data?: { message?: unknown };
    };
    const parts = [status, statusText, message ?? data?.message].filter(
      (part) => typeof part === 'string' || typeof part === 'number'
    );
    return parts.length ? redactUrlsIn(parts.join(' ')) : 'an error with no message';
  }
  return redactUrlsIn(String(error));
}
