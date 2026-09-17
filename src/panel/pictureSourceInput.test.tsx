import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';

import { MAX_UPLOAD_CHARS, PictureSourceInput } from './pictureSourceInput';
import { pictureKey } from './pictureKeys';
import { recordPictureAssignment, recordPictureOutcome, resetPictureStateForTests } from './pictureState';
import { SYMBOL_MESSAGES } from './symbolMessages';

/** The kepler layer the panel is handed; only its identity matters to the input. */
const layer = { id: 'l1' };

/** An assignment as `assignPictures` makes one, for these URLs drawn with a centre anchor. */
function assignment(urls: string[], extra: Record<string, unknown> = {}) {
  return {
    keys: urls.map((url) => pictureKey(url, 'center')),
    urls,
    failures: [],
    moreFailures: 0,
    overflow: 0,
    ...extra,
  };
}

function renderInput(props: Partial<React.ComponentProps<typeof PictureSourceInput>> = {}) {
  const onChange = jest.fn();
  const utils = render(
    <IntlProvider locale="en" messages={{ ...messages.en, ...SYMBOL_MESSAGES }}>
      <ThemeProvider theme={theme}>
        <PictureSourceInput layer={layer} value="" onChange={onChange} {...props} />
      </ThemeProvider>
    </IntlProvider>
  );
  return { onChange, ...utils };
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  resetPictureStateForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PictureSourceInput', () => {
  it('writes the URL when the field loses focus, not on every keystroke', () => {
    const { onChange } = renderInput();
    const field = screen.getByPlaceholderText('https://…');

    fireEvent.change(field, { target: { value: 'https://example.org/p' } });
    fireEvent.change(field, { target: { value: 'https://example.org/pin.png ' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledWith('https://example.org/pin.png');
  });

  it('writes the URL on Enter too', () => {
    const { onChange } = renderInput();
    const field = screen.getByPlaceholderText('https://…');

    fireEvent.change(field, { target: { value: 'https://example.org/pin.png' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('https://example.org/pin.png');
  });

  it('writes nothing when the URL did not change', () => {
    const { onChange } = renderInput({ value: 'https://example.org/pin.png' });

    fireEvent.blur(screen.getByPlaceholderText('https://…'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('writes an uploaded image as a data URI', async () => {
    const { onChange, container } = renderInput();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'pin.png', { type: 'image/png' });

    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/)));
  });

  it('refuses a file that is not an image, and writes nothing', async () => {
    const { onChange, container } = renderInput();
    const file = new File(['<html>'], 'page.html', { type: 'text/html' });

    fireEvent.change(fileInput(container), { target: { files: [file] } });

    expect(await screen.findByText('Not an image')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses an image too large to keep in the dashboard, and writes nothing', async () => {
    const { onChange, container } = renderInput();
    const file = new File([new Uint8Array(MAX_UPLOAD_CHARS)], 'huge.png', { type: 'image/png' });

    fireEvent.change(fileInput(container), { target: { files: [file] } });

    expect(await screen.findByText('The file is larger than 75 KB')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drops a refused upload’s message once a URL is written instead', async () => {
    const { onChange, container } = renderInput();
    fireEvent.change(fileInput(container), {
      target: { files: [new File(['<html>'], 'page.html', { type: 'text/html' })] },
    });
    expect(await screen.findByText('Not an image')).toBeInTheDocument();

    const field = screen.getByPlaceholderText('https://…');
    fireEvent.change(field, { target: { value: 'https://example.org/pin.png' } });
    fireEvent.blur(field);

    expect(onChange).toHaveBeenCalledWith('https://example.org/pin.png');
    expect(screen.queryByText('Not an image')).not.toBeInTheDocument();
  });

  it('shows an uploaded picture by its size rather than as a wall of base64, and lets it go', () => {
    const { onChange } = renderInput({ value: `data:image/png;base64,${'A'.repeat(4096)}` });

    expect(screen.getByText('Uploaded picture (3 KB)')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('https://…')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Use a URL instead'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('previews the picture the way the map loads it: anonymous and cross-origin', () => {
    const { container } = renderInput({ value: 'https://example.org/pin.png' });
    const preview = container.querySelector('img') as HTMLImageElement;

    expect(preview.getAttribute('src')).toBe('https://example.org/pin.png');
    expect(preview.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('names the pictures that could not load, and why', async () => {
    renderInput({ value: 'https://example.org/pin.png' });

    await act(async () => {
      recordPictureAssignment(
        layer,
        assignment(['https://a/1.png', 'https://a/2.png'], { failures: [{ url: 'javascript:x', problem: 'scheme' }] })
      );
      recordPictureOutcome(pictureKey('https://a/2.png', 'center'), 'https://a/2.png', 'load');
      await Promise.resolve();
    });

    expect(screen.getByText('2 of 3 pictures could not load')).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/a\/2\.png — Could not load/)).toBeInTheDocument();
    expect(screen.getByText(/javascript:x — Only https, http and data:image URLs/)).toBeInTheDocument();
  });

  it('counts the failures too many to name', async () => {
    renderInput({ value: 'https://example.org/pin.png' });

    await act(async () => {
      recordPictureAssignment(
        layer,
        assignment(['https://a/1.png'], { failures: [{ url: 'javascript:x', problem: 'scheme' }], moreFailures: 4 })
      );
      await Promise.resolve();
    });

    expect(screen.getByText('5 of 6 pictures could not load')).toBeInTheDocument();
  });

  it('reports its own layer’s pictures, not those of another panel’s layer with the same id', async () => {
    renderInput({ value: 'https://example.org/pin.png' });

    await act(async () => {
      recordPictureAssignment(
        { id: 'l1' },
        assignment(['https://a/1.png'], { failures: [{ url: 'javascript:x', problem: 'scheme' }], overflow: 5 })
      );
      await Promise.resolve();
    });

    expect(screen.queryByText(/could not load/)).not.toBeInTheDocument();
    expect(screen.queryByText(/over the 96 limit/)).not.toBeInTheDocument();
  });

  it('says the pictures over the cap take the layer picture, when there is one', async () => {
    renderInput({ value: 'https://example.org/pin.png' });

    await act(async () => {
      recordPictureAssignment(layer, assignment(['https://a/1.png'], { overflow: 40 }));
      await Promise.resolve();
    });

    expect(screen.getByText('40 pictures over the 96 limit use the layer picture')).toBeInTheDocument();
  });

  it('says the pictures over the cap are not drawn, when there is no layer picture', async () => {
    renderInput({ value: '' });

    await act(async () => {
      recordPictureAssignment(layer, assignment(['https://a/1.png'], { overflow: 40 }));
      await Promise.resolve();
    });

    expect(screen.getByText('40 pictures over the 96 limit are not drawn')).toBeInTheDocument();
    expect(screen.queryByText(/use the layer picture/)).not.toBeInTheDocument();
  });
});
