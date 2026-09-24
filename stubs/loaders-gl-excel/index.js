// Stands in for @loaders.gl/excel, which kepler.gl's file loader imports only when an Excel file is
// dropped on its Add Data dialog. The real package depends on SheetJS (`xlsx`), and every `xlsx`
// release on npm carries advisories with no fixed version, which the Grafana plugin validator
// reports as errors. Overriding the loader keeps `xlsx` out of the lockfile and the bundle.
//
// kepler's loader list stays as it is: this loader claims the same file types, so an Excel file
// is refused with a message that says what to do instead of being misread as another format.
export const ExcelLoader = {
  name: 'Excel',
  id: 'excel',
  module: 'excel',
  version: '4.5.2-stub.0',
  extensions: ['xls', 'xlsb', 'xlsm', 'xlsx'],
  mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
  category: 'table',
  binary: true,
  dataType: null,
  batchType: null,
  worker: false,
  options: { excel: {} },
  async parse() {
    throw new Error('Excel files cannot be loaded in this panel. Save the sheet as CSV and load that instead.');
  },
};
