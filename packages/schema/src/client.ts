/**
 * The shape of the write requests this build of the app sends, sent as the `frontier-api` header
 * on every request and written to the build's `build.json`.
 *
 * Raise it when a write request changes shape or meaning so that an older server would misread
 * it. Once the app is kept on the device, a deploy no longer reaches an open app at once, so a
 * later server can tell old clients apart by it. Until a server refuses old writes, raise it only
 * together with a server that still reads the old shape.
 */
export const CLIENT_API = 1;
