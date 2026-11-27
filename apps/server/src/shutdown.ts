/** What stopping needs of `process`: to hear a signal once, and to exit. */
export interface Signals {
  once(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  exit(code: number): unknown;
}

/**
 * Stopping the server on SIGTERM or SIGINT (what `docker stop` sends). Closing the app lets the
 * work that goes on after an answer finish first: mail being sent, a member's last-active note.
 * A second signal while it closes is left alone, and a close that fails still ends the process.
 */
export function closeOnSignals(
  app: { close(): Promise<unknown>; log: { error(object: object, message: string): void } },
  process: Signals,
): void {
  let closing = false;
  const stop = (): void => {
    if (closing) return;
    closing = true;
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, "The server did not close cleanly");
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
