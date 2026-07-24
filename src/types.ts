import { FieldRoles } from './data/detectFields';

export interface KeplerPanelOptions {
  /**
   * Field mapping overrides, keyed by query refId. Anything absent falls back
   * to autodetection, so the panel works with no configuration at all.
   */
  fieldMappings?: Record<string, FieldRoles>;
}
