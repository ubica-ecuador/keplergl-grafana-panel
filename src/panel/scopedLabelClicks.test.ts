import { misdirectedLabelTarget, scopeLabelClicks } from './scopedLabelClicks';

function panel(checked: { value: boolean }): HTMLElement {
  const root = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = 'symbol-grafana-A-upright-switch';
  input.addEventListener('change', () => (checked.value = input.checked));
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = 'Upright';
  root.append(input, label);
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('scopeLabelClicks', () => {
  it('toggles the input of the panel clicked, not the first one with that id', () => {
    const upper = { value: false };
    const lower = { value: false };
    const upperRoot = panel(upper);
    const lowerRoot = panel(lower);
    const removeUpper = scopeLabelClicks(upperRoot);
    const removeLower = scopeLabelClicks(lowerRoot);

    lowerRoot.querySelector('label')!.click();
    expect(lower.value).toBe(true);
    expect(upper.value).toBe(false);

    upperRoot.querySelector('label')!.click();
    expect(upper.value).toBe(true);
    expect(lower.value).toBe(true);

    removeUpper();
    removeLower();
  });

  it('leaves a label alone when its id is already unambiguous', () => {
    const only = { value: false };
    const root = panel(only);
    expect(misdirectedLabelTarget(root, root.querySelector('label'))).toBeNull();
    const remove = scopeLabelClicks(root);
    root.querySelector('label')!.click();
    expect(only.value).toBe(true);
    remove();
  });

  it('ignores clicks that are not on a label of its own panel', () => {
    const root = panel({ value: false });
    const other = panel({ value: false });
    expect(misdirectedLabelTarget(root, root.querySelector('input'))).toBeNull();
    expect(misdirectedLabelTarget(root, other.querySelector('label'))).toBeNull();
    expect(misdirectedLabelTarget(root, null)).toBeNull();
  });
});
