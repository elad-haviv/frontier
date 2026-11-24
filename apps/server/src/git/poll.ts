/** Fetches on a timer, in case a webhook was missed. Returns a function that stops it. */
export function startPolling(
  sync: () => Promise<void>,
  onError: (err: unknown) => void,
  everyMs = 5 * 60 * 1000,
) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sync()
      .catch(onError)
      .finally(() => {
        running = false;
      });
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
