/**
 * Whether a dialog (the key sheet too), the quick switcher or the image viewer is over the page, so
 * its keys keep out. The switcher is a dialog without a scrim of its own.
 */
export const overlayOpen = (): boolean =>
  document.querySelector(".dialog-scrim, .lightbox, .switcher") !== null;
