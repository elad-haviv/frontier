/** Whether a dialog (the key sheet too) or the image viewer is over the page, so its keys keep out. */
export const overlayOpen = (): boolean =>
  document.querySelector(".dialog-scrim, .lightbox") !== null;
