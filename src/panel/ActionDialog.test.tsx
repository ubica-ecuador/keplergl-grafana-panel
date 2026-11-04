import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ActionDialog } from './ActionDialog';
import type { MapAction } from './mapActions';

/**
 * The dialog an action goes through: values first when it asks for any, then
 * Grafana's confirmation, and the request only on Confirm.
 */

const request = (values?: Record<string, string>) => ({
  url: 'https://ops.example/close',
  method: 'POST',
  data: JSON.stringify({ note: values?.note ?? '' }),
  headers: { 'X-Grafana-Action': '1' },
});

const close = (over: Partial<MapAction> = {}): MapAction => ({
  title: 'Close report r-1',
  oneClick: false,
  variables: [],
  confirmation: (values) => `Close r-1${values?.note ? ` saying "${values.note}"` : ''}?`,
  request,
  ...over,
});

describe('ActionDialog', () => {
  it('shows nothing without an action', () => {
    const { container } = render(<ActionDialog action={null} onClose={jest.fn()} send={jest.fn()} />);
    expect(container.textContent).toBe('');
  });

  // Grafana's ConfirmModal submits through react-hook-form, which calls
  // onConfirm a tick after the click.
  it('confirms, then sends the request and closes', async () => {
    const send = jest.fn();
    const onClose = jest.fn();
    render(<ActionDialog action={close()} onClose={onClose} send={send} />);
    expect(screen.getByText('Confirm action')).toBeTruthy();
    expect(screen.getByText('Close r-1?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(request()));
    expect(onClose).toHaveBeenCalled();
  });

  it('sends nothing when dismissed', () => {
    const send = jest.fn();
    const onClose = jest.fn();
    render(<ActionDialog action={close()} onClose={onClose} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(send).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for the action’s values first, and carries them into the request', async () => {
    const send = jest.fn();
    render(
      <ActionDialog action={close({ variables: [{ key: 'note', name: 'Note' }] })} onClose={jest.fn()} send={send} />
    );
    expect(screen.queryByText('Confirm action')).toBeNull();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'cleared' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Close r-1 saying "cleared"?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(request({ note: 'cleared' })));
  });
});
