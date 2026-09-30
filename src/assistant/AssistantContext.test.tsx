import React from 'react';
import { render, waitFor } from '@testing-library/react';

jest.mock('@grafana/assistant', () => ({
  isAssistantAvailable: jest.fn(),
  providePageContext: jest.fn(),
  provideQuestions: jest.fn(),
  createAssistantContextItem: jest.fn((type: string, params: { title?: string; data: unknown }) => ({
    node: { id: 'item', name: params.title ?? 'item', navigable: false },
    occurrences: [],
  })),
}));

import { isAssistantAvailable, providePageContext, provideQuestions, createAssistantContextItem } from '@grafana/assistant';

import { AssistantContext, AssistantComposition, type AssistantContextProps } from './AssistantContext';
import type { AssistantDigest } from './digest';

const mockIsAvailable = isAssistantAvailable as jest.Mock;
const mockProvidePageContext = providePageContext as jest.Mock;
const mockProvideQuestions = provideQuestions as jest.Mock;
const mockCreateAssistantContextItem = createAssistantContextItem as jest.Mock;

/** An Observable-like source that resolves asynchronously, like the real SDK. */
function availability(value: boolean) {
  return {
    subscribe(observer: { next: (v: boolean) => void }) {
      Promise.resolve().then(() => observer.next(value));
      return { unsubscribe() {} };
    },
  };
}

function fakeTime(iso: string, epochMs: number) {
  return { valueOf: () => epochMs, toISOString: () => iso };
}

function fakeProps(overrides: Partial<AssistantContextProps> = {}): AssistantContextProps {
  const base = {
    id: 1,
    title: undefined,
    data: { series: [] },
    options: {},
    timeRange: {
      from: fakeTime('2024-01-01T00:00:00.000Z', 1000),
      to: fakeTime('2024-01-01T01:00:00.000Z', 2000),
    },
  };
  return { ...base, ...overrides } as unknown as AssistantContextProps;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProvidePageContext.mockReturnValue(Object.assign(jest.fn(), { unregister: jest.fn() }));
  mockProvideQuestions.mockReturnValue(Object.assign(jest.fn(), { unregister: jest.fn() }));
});

it('registers nothing when the assistant is unavailable and does not throw', async () => {
  mockIsAvailable.mockReturnValue(availability(false));

  const { unmount } = render(<AssistantContext {...fakeProps()} />);
  await waitFor(() => expect(mockIsAvailable).toHaveBeenCalled());

  expect(mockProvidePageContext).not.toHaveBeenCalled();
  expect(mockProvideQuestions).not.toHaveBeenCalled();
  unmount();
});

describe('when the assistant is available', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(availability(true));
  });

  it('registers page context and suggested questions for the dashboard URL', async () => {
    render(<AssistantContext {...fakeProps({ title: 'Fleet map' })} />);

    await waitFor(() => expect(mockProvidePageContext).toHaveBeenCalledTimes(1));
    expect(mockProvideQuestions).toHaveBeenCalledTimes(1);

    const [urlPattern, items] = mockProvidePageContext.mock.calls[0];
    expect(urlPattern).toBeInstanceOf(RegExp);
    expect((urlPattern as RegExp).test('/d/abc123/some-dashboard')).toBe(true);
    expect(items).toHaveLength(1);

    const [questionsPattern, questions] = mockProvideQuestions.mock.calls[0];
    expect((questionsPattern as RegExp).test('/d/abc123')).toBe(true);
    expect(questions).toEqual([
      { title: 'Explain this map', prompt: 'Explain what this Kepler map is showing.' },
      { title: 'Busiest area', prompt: 'Which area of this map has the most points?' },
    ]);
  });

  it('re-registers when a digest input changes, unregistering the prior registration first', async () => {
    const unregisterCtx1 = jest.fn();
    const unregisterQuestions1 = jest.fn();
    mockProvidePageContext.mockReturnValueOnce(Object.assign(jest.fn(), { unregister: unregisterCtx1 }));
    mockProvideQuestions.mockReturnValueOnce(Object.assign(jest.fn(), { unregister: unregisterQuestions1 }));

    const seriesA = [{ refId: 'A', name: 'gps', length: 10, fields: [] }];
    const { rerender } = render(<AssistantContext {...fakeProps({ data: { series: seriesA } as never })} />);
    await waitFor(() => expect(mockProvidePageContext).toHaveBeenCalledTimes(1));

    const unregisterCtx2 = jest.fn();
    const unregisterQuestions2 = jest.fn();
    mockProvidePageContext.mockReturnValueOnce(Object.assign(jest.fn(), { unregister: unregisterCtx2 }));
    mockProvideQuestions.mockReturnValueOnce(Object.assign(jest.fn(), { unregister: unregisterQuestions2 }));

    // A new series with a different refId:length changes the digest.
    const seriesB = [{ refId: 'A', name: 'gps', length: 20, fields: [] }];
    rerender(<AssistantContext {...fakeProps({ data: { series: seriesB } as never })} />);

    await waitFor(() => expect(mockProvidePageContext).toHaveBeenCalledTimes(2));
    expect(unregisterCtx1).toHaveBeenCalledTimes(1);
    expect(mockProvideQuestions).toHaveBeenCalledTimes(2);
    expect(unregisterQuestions1).toHaveBeenCalledTimes(1);
  });

  it('unregisters both the context and the questions on unmount', async () => {
    const unregisterCtx = jest.fn();
    const unregisterQuestions = jest.fn();
    mockProvidePageContext.mockReturnValue(Object.assign(jest.fn(), { unregister: unregisterCtx }));
    mockProvideQuestions.mockReturnValue(Object.assign(jest.fn(), { unregister: unregisterQuestions }));

    const { unmount } = render(<AssistantContext {...fakeProps()} />);
    await waitFor(() => expect(mockProvidePageContext).toHaveBeenCalledTimes(1));

    unmount();

    expect(unregisterCtx).toHaveBeenCalledTimes(1);
    expect(unregisterQuestions).toHaveBeenCalledTimes(1);
  });

  it('falls back the base map to the resolved id when no styleType is saved', async () => {
    render(<AssistantContext {...fakeProps({ resolvedBasemapId: 'dark-matter' })} />);

    await waitFor(() => expect(mockCreateAssistantContextItem).toHaveBeenCalledTimes(1));

    const data = mockCreateAssistantContextItem.mock.calls[0][1].data as AssistantDigest;
    expect(data.baseMap).toEqual({ id: 'dark-matter' });
  });

  it('re-registers when the resolved base map id changes', async () => {
    const { rerender } = render(<AssistantContext {...fakeProps({ resolvedBasemapId: 'dark-matter' })} />);
    await waitFor(() => expect(mockProvidePageContext).toHaveBeenCalledTimes(1));

    rerender(<AssistantContext {...fakeProps({ resolvedBasemapId: 'positron' })} />);
    await waitFor(() => expect(mockProvidePageContext).toHaveBeenCalledTimes(2));

    const data = mockCreateAssistantContextItem.mock.calls[1][1].data as AssistantDigest;
    expect(data.baseMap).toEqual({ id: 'positron' });
  });

  it('fills bounds from the saved mapState rather than leaving it undefined', async () => {
    const mapState = { latitude: 1, longitude: 2, zoom: 3 };
    const mapConfig = { version: 'v1', config: { mapState } } as never;

    render(<AssistantContext {...fakeProps({ options: { mapConfig } as never })} />);

    await waitFor(() => expect(mockCreateAssistantContextItem).toHaveBeenCalledTimes(1));

    const data = mockCreateAssistantContextItem.mock.calls[0][1].data as AssistantDigest;
    expect(data.bounds).toEqual(mapState);
  });

  it('registers exactly the base digest when no composition provider wraps it', async () => {
    render(<AssistantContext {...fakeProps({ title: 'Fleet map' })} />);

    await waitFor(() => expect(mockCreateAssistantContextItem).toHaveBeenCalledTimes(1));

    const [, params] = mockCreateAssistantContextItem.mock.calls[0];
    expect(params.title).toBe('Kepler map — Fleet map (live)');
    expect(params.data).toEqual(
      expect.objectContaining({ datasets: [], filters: [], timeRange: expect.any(Object) })
    );
  });

  it('lets a composing host (e.g. Plus) extend the digest and override the title', async () => {
    const extendDigest = jest.fn((digest: AssistantDigest) => ({ ...digest, plusOnly: 'extra-field' }));

    render(
      <AssistantComposition.Provider value={{ extendDigest, title: 'Plus map' }}>
        <AssistantContext {...fakeProps({ title: 'Fleet map' })} />
      </AssistantComposition.Provider>
    );

    await waitFor(() => expect(mockCreateAssistantContextItem).toHaveBeenCalledTimes(1));

    const [, params] = mockCreateAssistantContextItem.mock.calls[0];
    expect(extendDigest).toHaveBeenCalled();
    // The title override wins over the panel-derived one.
    expect(params.title).toBe('Plus map');
    // The extended data carries both the base digest fields and the addition.
    expect(params.data).toEqual(
      expect.objectContaining({ plusOnly: 'extra-field', datasets: [], filters: [], timeRange: expect.any(Object) })
    );
  });
});
