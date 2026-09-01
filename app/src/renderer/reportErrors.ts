/**
 * Send renderer failures somewhere a person will see them.
 *
 * An unhandled rejection inside an effect leaves the app sitting in its initial
 * state with an empty file list and no explanation, and it never reaches the
 * main process log on its own. console.error does, through the window's
 * console-message handler.
 */
export function reportErrors() {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { stack?: string } | undefined;
    console.error('[unhandled rejection]', reason?.stack ?? String(event.reason));
  });
  window.addEventListener('error', (event) => {
    console.error('[uncaught]', event.error?.stack ?? event.message);
  });
}
