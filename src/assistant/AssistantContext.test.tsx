import React from 'react';
import { render, waitFor } from '@testing-library/react';
import type { PanelProps } from '@grafana/data';

import type { KeplerPanelOptions } from '../types';

jest.mock('@grafana/assistant', () => ({
  isAssistantAvailable: jest.fn(),
  providePageContext: jest.fn(),
  provideQuestions: jest.fn(),
  createAssistantContextItem: jest.fn((type: string, params: { title?: string; data: unknown }) => ({
    node: { id: 'item', name: params.title ?? 'item', navigable: false },
    occurrences: [],
  })),
}));

import { isAssistantAvailable, providePageContext, provideQuestions } from '@grafana/assistant';

import { AssistantContext } from './AssistantContext';

const mockIsAvailable = isAssistantAvailable as jest.Mock;
const mockProvidePageContext = providePageContext as jest.Mock;
const mockProvideQuestions = provideQuestions as jest.Mock;

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

function fakeProps(overrides: Partial<PanelProps<KeplerPanelOptions>> = {}): PanelProps<KeplerPanelOptions> {
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
  return { ...base, ...overrides } as unknown as PanelProps<KeplerPanelOptions>;
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
});
