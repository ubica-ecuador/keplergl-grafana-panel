import React, { useState } from 'react';
import { AppEvents } from '@grafana/data';
import { getAppEvents, getBackendSrv } from '@grafana/runtime';
import { Button, ConfirmModal, Field, Input, Modal } from '@grafana/ui';

import type { ActionRequest, MapAction } from './mapActions';

/**
 * Sends an action's request the way Grafana's own panels do: through the
 * backend service (so a request to this Grafana carries the session), with the
 * same two notices.
 */
export function sendActionRequest(request: ActionRequest): void {
  const notify = (type: string, message: string) => getAppEvents().publish({ type, payload: [message] });
  try {
    getBackendSrv()
      .fetch(request)
      .subscribe({
        error: (error: unknown) => {
          notify(AppEvents.alertError.name, 'An error has occurred. Check console output for more details.');
          console.error(error);
        },
        complete: () => notify(AppEvents.alertSuccess.name, 'API call was successful'),
      });
  } catch (error) {
    notify(AppEvents.alertError.name, 'An error has occurred. Check console output for more details.');
    console.error(error);
  }
}

/**
 * The dialog an action goes through before it is sent: the values it asks the
 * viewer for, if it declares any, then Grafana's confirmation.
 *
 * Rendered by the panel outside kepler's subtree, where @grafana/ui finds
 * Grafana's own context (KeplerMap's note on the redux Provider); the popup's
 * buttons only name the action. Every action is confirmed, as in Grafana: the
 * request does something, and a click on a crowded map is easy to misplace.
 */
export function ActionDialog({
  action,
  onClose,
  send = sendActionRequest,
}: {
  action: MapAction | null;
  onClose: () => void;
  /** How the request is sent; a test hands its own. */
  send?: (request: ActionRequest) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'variables' | 'confirm'>('confirm');
  // Reset in the render that brings a new action, not in an effect after it:
  // an effect would show the confirmation for one frame before the values.
  const [shown, setShown] = useState<MapAction | null>(null);
  if (shown !== action) {
    setShown(action);
    setValues({});
    setStep(action?.variables.length ? 'variables' : 'confirm');
  }

  if (!action || shown !== action) {
    return null;
  }

  if (step === 'variables') {
    return (
      <Modal isOpen title={action.title} onDismiss={onClose}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setStep('confirm');
          }}
        >
          {action.variables.map((variable) => (
            <Field key={variable.key} label={variable.name || variable.key}>
              <Input
                id={`map-action-${variable.key}`}
                value={values[variable.key] ?? ''}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setValues((current) => ({ ...current, [variable.key]: value }));
                }}
              />
            </Field>
          ))}
          <Modal.ButtonRow>
            <Button variant="secondary" fill="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Continue</Button>
          </Modal.ButtonRow>
        </form>
      </Modal>
    );
  }

  return (
    <ConfirmModal
      isOpen
      title="Confirm action"
      body={action.confirmation(values)}
      confirmText="Confirm"
      confirmVariant="primary"
      onConfirm={() => {
        send(action.request(values));
        onClose();
      }}
      onDismiss={onClose}
    />
  );
}
