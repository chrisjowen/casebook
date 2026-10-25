/**
 * The shell's overlays, open from anywhere: a page's own New process button opens the same dialog
 * as the New menu. Only changed in the browser, by user actions.
 */
export const shellUi = $state({ palette: false, newProcess: false, importing: false });
