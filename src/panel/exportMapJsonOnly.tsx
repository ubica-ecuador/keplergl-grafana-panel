import React, { useEffect, useMemo } from 'react';
import { ExportJsonMapFactory, ExportMapModalFactory } from '@kepler.gl/components';
import { EXPORT_MAP_FORMAT_OPTIONS, EXPORT_MAP_FORMATS } from '@kepler.gl/constants';
import { messages } from '@kepler.gl/localization';

type Factory = typeof ExportMapModalFactory;
type ModalProps = {
  options?: { format?: string } & Record<string, unknown>;
  onChangeExportMapFormat?: (format: string) => void;
} & Record<string, unknown>;

/**
 * Share → Export Map, as JSON only.
 *
 * kepler's dialog offers two formats, and its default is HTML: a standalone
 * page that loads React, Redux and styled-components from esm.sh, kepler.gl
 * itself from unpkg.com and its fonts from CloudFront, wherever it is opened.
 * The panel ships every line of code it runs and fetches none from a CDN, so
 * it does not hand out a file that does. The HTML panel of the dialog also
 * draws three preview pictures of the export's modes, each fetched from
 * kepler's documentation bucket on CloudFront (`getHTMLMapModeTileUrl`) the
 * moment the dialog opens, even with JSON chosen, since the panel is mounted
 * either way. Here the dialog is kepler's own, built with no HTML panel, with
 * JSON as its one format: no picture is fetched, and Export writes kepler's
 * JSON (the map and its configuration, which kepler.gl reopens).
 *
 * The format the Export button writes is the store's (`uiState.exportMap
 * .format`, read by kepler's ModalContainer), and kepler's default is HTML, so
 * the dialog sets JSON as it opens, before anything can be exported.
 */
const NoHtmlExport: React.FC = () => null;
NoHtmlExport.displayName = 'NoHtmlExport';

/** kepler's own list of formats, read by the dialog's selector: HTML leaves it. */
function dropHtmlFormat(): void {
  for (let i = EXPORT_MAP_FORMAT_OPTIONS.length - 1; i >= 0; i--) {
    if (EXPORT_MAP_FORMAT_OPTIONS[i].id === EXPORT_MAP_FORMATS.HTML) {
      EXPORT_MAP_FORMAT_OPTIONS.splice(i, 1);
    }
  }
}

/** The help next to "Map format" names both formats; say why one is missing. */
export const EXPORT_MAP_MESSAGES: Record<string, string> = {
  'modal.exportMap.formatHtmlHelp':
    'not offered here: an HTML export loads kepler.gl, React and its fonts from public CDNs wherever it is opened.',
};

export function registerExportMapMessages(catalogues: Record<string, Record<string, string>>): void {
  for (const messages of Object.values(catalogues)) {
    Object.assign(messages, EXPORT_MAP_MESSAGES);
  }
}

function JsonOnlyExportMapModalFactory(ExportJsonMap: unknown) {
  dropHtmlFormat();
  // Here rather than in keplerConfig.ts, which must not import kepler's
  // components: they reach the panel's export writers (exportSqlJs.ts), whose
  // loaderOptions.ts imports keplerConfig.ts, and the cycle left a binding
  // uninitialised when the map's chunk loaded.
  registerExportMapMessages(messages);
  const KeplerExportMapModal = (
    ExportMapModalFactory as unknown as (html: unknown, json: unknown) => React.FC<ModalProps>
  )(NoHtmlExport, ExportJsonMap);

  function ExportMapModalJsonOnly(props: ModalProps) {
    const { options, onChangeExportMapFormat } = props;
    const format = options?.format;
    useEffect(() => {
      if (format !== EXPORT_MAP_FORMATS.JSON) {
        onChangeExportMapFormat?.(EXPORT_MAP_FORMATS.JSON);
      }
    }, [format, onChangeExportMapFormat]);
    const jsonOptions = useMemo(() => ({ ...options, format: EXPORT_MAP_FORMATS.JSON }), [options]);
    return <KeplerExportMapModal {...props} options={jsonOptions} />;
  }
  ExportMapModalJsonOnly.displayName = 'ExportMapModalJsonOnly';
  return ExportMapModalJsonOnly;
}
JsonOnlyExportMapModalFactory.deps = [ExportJsonMapFactory];

/** The recipe `injectComponents` expects to swap kepler's Export Map dialog. */
export function replaceExportMapModal(): [Factory, Factory] {
  return [ExportMapModalFactory, JsonOnlyExportMapModalFactory as unknown as Factory];
}
