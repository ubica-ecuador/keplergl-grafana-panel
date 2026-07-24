import { FieldRoles } from './data/detectFields';
import { SavedMapConfig } from './data/mapConfig';

export interface KeplerPanelOptions {
  /**
   * Field mapping overrides, keyed by query refId. Anything absent falls back
   * to autodetection, so the panel works with no configuration at all.
   */
  fieldMappings?: Record<string, FieldRoles>;

  /**
   * The saved map configuration: layers, filters, interactions, base map.
   * Written by the panel when the user asks for a save, and applied on load.
   */
  mapConfig?: SavedMapConfig | null;

  /**
   * Save request counter.
   *
   * Grafana gives panel option editors no channel to the panel component, and
   * the map state lives in the panel's Redux store — so the editor bumps this
   * counter and the panel, which can see its own store, does the capture. A
   * counter rather than a boolean so repeated saves always register.
   */
  saveRequest?: number;
}
