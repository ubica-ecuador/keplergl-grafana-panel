jest.mock('@grafana/assistant', () => ({
  isAssistantAvailable: jest.fn(),
  providePageContext: jest.fn(),
  provideQuestions: jest.fn(),
  createAssistantContextItem: jest.fn((type: string, params: { title?: string; data: unknown }) => ({
    node: { id: 'item', name: params.title ?? 'item', navigable: false },
    occurrences: [],
  })),
}));

import { provideQuestions, createAssistantContextItem } from '@grafana/assistant';

import { registerAssistantQuestions, buildContextItems } from './pageContext';
import type { AssistantDigest } from './digest';

const mockProvideQuestions = provideQuestions as jest.Mock;
const mockCreateAssistantContextItem = createAssistantContextItem as jest.Mock;

function fakeRegistration() {
  return Object.assign(jest.fn(), { unregister: jest.fn() });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Every test releases exactly as many registrations as it takes out, so the
// module-level ref count is back at zero before the next test runs — nothing
// in this suite resets it between tests.
describe('registerAssistantQuestions', () => {
  it('registers once for two concurrently mounted panels (split map, panel-edit double-mount)', () => {
    const registration = fakeRegistration();
    mockProvideQuestions.mockReturnValue(registration);

    const unregisterA = registerAssistantQuestions();
    const unregisterB = registerAssistantQuestions();

    expect(mockProvideQuestions).toHaveBeenCalledTimes(1);

    unregisterA();
    unregisterB();
  });

  it('stays registered while at least one mount still holds it', () => {
    const registration = fakeRegistration();
    mockProvideQuestions.mockReturnValue(registration);

    const unregisterA = registerAssistantQuestions();
    const unregisterB = registerAssistantQuestions();

    unregisterA();

    expect(registration.unregister).not.toHaveBeenCalled();

    unregisterB();
  });

  it('unregisters once the last mount releases it', () => {
    const registration = fakeRegistration();
    mockProvideQuestions.mockReturnValue(registration);

    const unregisterA = registerAssistantQuestions();
    const unregisterB = registerAssistantQuestions();

    unregisterA();
    unregisterB();

    expect(registration.unregister).toHaveBeenCalledTimes(1);
  });

  it('registers again once every previous mount has released it', () => {
    const first = fakeRegistration();
    const second = fakeRegistration();
    mockProvideQuestions.mockReturnValueOnce(first).mockReturnValueOnce(second);

    registerAssistantQuestions()();
    expect(first.unregister).toHaveBeenCalledTimes(1);

    const unregisterSecond = registerAssistantQuestions();

    expect(mockProvideQuestions).toHaveBeenCalledTimes(2);

    unregisterSecond();
  });

  it('is idempotent: releasing the same unregister fn twice only counts once', () => {
    const registration = fakeRegistration();
    mockProvideQuestions.mockReturnValue(registration);

    const unregisterA = registerAssistantQuestions();
    const unregisterB = registerAssistantQuestions();

    unregisterA();
    unregisterA();

    expect(registration.unregister).not.toHaveBeenCalled();

    unregisterB();
  });
});

describe('buildContextItems', () => {
  const digest: AssistantDigest = {
    datasets: [],
    baseMap: { id: 'dark-matter' },
    filters: [],
    timeRange: { from: 't0', to: 't1' },
  };

  it('uses the digest itself as the item data by default', () => {
    buildContextItems(digest, 'A title');

    expect(mockCreateAssistantContextItem).toHaveBeenCalledWith(
      'structured',
      expect.objectContaining({ title: 'A title', data: digest })
    );
  });

  it('uses the supplied data override instead of the raw digest when given one', () => {
    const overridden = { ...digest, extra: 'plus-field' };

    buildContextItems(digest, 'A title', overridden);

    expect(mockCreateAssistantContextItem).toHaveBeenCalledWith(
      'structured',
      expect.objectContaining({ data: overridden })
    );
  });
});
