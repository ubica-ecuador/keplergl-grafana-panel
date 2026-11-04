import { removeAnnotation, wrapTo } from '@kepler.gl/actions';

import { KEPLER_INSTANCE_ID } from './constants';
import { createKeplerStore, onKeplerAction } from './keplerStore';

describe('onKeplerAction', () => {
  it('hears a wrapped action with its own payload, until it stops listening', () => {
    const store = createKeplerStore();
    const heard: Array<{ type: string; payload?: unknown }> = [];
    const stop = onKeplerAction(store, (action) => heard.push(action));

    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, removeAnnotation('grafana-7')));
    expect(heard).toHaveLength(1);
    expect(heard[0].type).toBe('@@kepler.gl/REMOVE_ANNOTATION');
    expect((heard[0].payload as { id: string }).id).toBe('grafana-7');

    stop();
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, removeAnnotation('grafana-8')));
    expect(heard).toHaveLength(1);
  });

  it('keeps one store from hearing another', () => {
    const a = createKeplerStore();
    const b = createKeplerStore();
    const heard: string[] = [];
    onKeplerAction(a, (action) => heard.push(action.type));
    b.dispatch(wrapTo(KEPLER_INSTANCE_ID, removeAnnotation('x')));
    expect(heard).toEqual([]);
  });
});
