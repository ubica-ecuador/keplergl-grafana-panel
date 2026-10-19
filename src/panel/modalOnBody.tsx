import React from 'react';
import styled from 'styled-components';
import { ModalDialogFactory } from '@kepler.gl/components';

type Factory = typeof ModalDialogFactory;
type DialogProps = { style?: React.CSSProperties } & Record<string, unknown>;

/**
 * Grafana's own modal backdrop layer (`theme.zIndex.modalBackdrop`). kepler's
 * 1001 clears the top bar (1000) but not the docked menu (1020), which would
 * sit undimmed over the dialog's left edge.
 */
export const MODAL_OVERLAY_Z_INDEX = 1050;

const documentBody = () => document.body;

/**
 * kepler's ModalContainer mounts every dialog — the dataset's data table, the
 * delete-dataset confirmation, Add Data, the exports — through a react-modal
 * whose `parentSelector` is KeplerGl's own root div, and sizes it for a page:
 * the data table is 90vw wide and 85vh tall, the overlay `position: fixed`
 * over the viewport.
 *
 * Inside a dashboard that root lives under `.react-grid-item`, whose CSS
 * transform makes the grid item the containing block for fixed descendants,
 * and under panel chrome that clips overflow. So the overlay covered the panel
 * alone and the dialog was cut at the panel's edges, its close button (top
 * right of a 90vw box) with it: the table could be neither read nor closed,
 * and the overlay swallowed every click on the map underneath.
 *
 * On document.body the dialog is the page-sized modal kepler drew, over the
 * whole dashboard. Two things it inherited inside the root are carried along:
 * the root's typography (kepler-gl.js's GlobalStyle), and a layer above
 * Grafana's chrome. Theme and intl travel through React context, which
 * crosses portals. The dropdowns opened inside the dialog (the column menus)
 * are already on document.body, at 9999 (portaledBodyMount.tsx).
 */
export function onDocumentBody(Dialog: React.ComponentType<DialogProps>): React.FC<DialogProps> {
  const DialogWithRootType = styled(Dialog)`
    font-family: ${(props) => props.theme.fontFamily};
    font-weight: ${(props) => props.theme.fontWeight};
    font-size: ${(props) => props.theme.fontSize};
    line-height: ${(props) => props.theme.lineHeight};

    *,
    *:before,
    *:after {
      box-sizing: border-box;
    }

    ul {
      margin: 0;
      padding: 0;
    }

    li {
      margin: 0;
    }

    a {
      text-decoration: none;
      color: ${(props) => props.theme.labelColor};
    }
  `;

  function ModalDialogOnBody(props: DialogProps) {
    return (
      <DialogWithRootType
        {...props}
        parentSelector={documentBody}
        // ModalDialog spreads `style` into react-modal's overlay style.
        style={{ zIndex: MODAL_OVERLAY_Z_INDEX, ...props.style }}
      />
    );
  }
  return ModalDialogOnBody;
}

// kepler's factory has no deps, so this recipe re-registers nothing else and
// can sit anywhere in keplerRecipes.ts.
function ModalDialogOnBodyFactory() {
  return onDocumentBody(ModalDialogFactory() as unknown as React.ComponentType<DialogProps>);
}

/** The recipe `injectComponents` expects to swap the stock modal dialog. */
export function replaceModalDialog(): [Factory, Factory] {
  return [ModalDialogFactory, ModalDialogOnBodyFactory as unknown as Factory];
}
