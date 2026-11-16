import { backToFront } from './splatOrder';
import { SORT_WORKER_SOURCE, sortWorker, workerSorter } from './sortWorker';

/** The worker's code run against a stand-in for its global scope. */
function startWorker() {
  const scope: { postMessage: jest.Mock; onmessage?: (event: { data: unknown }) => void } = { postMessage: jest.fn() };
  new Function('self', SORT_WORKER_SOURCE)(scope);
  return scope;
}

describe('the sorting worker', () => {
  const positions = new Float32Array(Array.from({ length: 3000 }, (_, i) => Math.sin(i * 12.9898) * 100));

  it('orders the splats as the main thread does, farthest first', () => {
    const scope = startWorker();
    scope.onmessage!({ data: { type: 'init', id: 7, positions } });
    scope.onmessage!({ data: { type: 'sort', id: 7, eye: [10, -20, 5], generation: 3 } });
    const [reply, transfer] = scope.postMessage.mock.calls[0];
    expect(reply.id).toBe(7);
    expect(reply.generation).toBe(3);
    expect(reply.eye).toEqual([10, -20, 5]);
    expect(Array.from(reply.order)).toEqual(Array.from(backToFront(positions, 1000, [10, -20, 5])));
    expect(transfer).toEqual([reply.order.buffer]);
  });

  it('forgets a dropped set, and answers nothing for one it does not hold', () => {
    const scope = startWorker();
    scope.onmessage!({ data: { type: 'init', id: 1, positions } });
    scope.onmessage!({ data: { type: 'drop', id: 1 } });
    scope.onmessage!({ data: { type: 'sort', id: 1, eye: [0, 0, 0], generation: 1 } });
    expect(scope.postMessage).not.toHaveBeenCalled();
  });

  it('is not started where the page has no workers, and the layers sort themselves', () => {
    // jsdom has none.
    expect(sortWorker()).toBeNull();
    expect(workerSorter(positions, () => {})).toBeNull();
  });
});
