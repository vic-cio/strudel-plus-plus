/**
 * Send renderer failures somewhere a person will see them.
 *
 * An unhandled rejection inside an effect leaves the app sitting in its initial
 * state with an empty file list and no explanation, and it never reaches the
 * main process log on its own. console.error does, through the window's
 * console-message handler.
 *
 * The console alone is not enough, though: a desktop app runs with its
 * terminal buried or gone, so a failure a person must act on is also handed to
 * subscribers. App subscribes and shows it in the error surface; a renderer
 * that survives an unexpected throw must at least say so where the eye is.
 */

type ErrorListener = (message: string) => void;

const listeners = new Set<ErrorListener>();

function describe(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.stack ?? reason.message;
  }
  if (typeof reason === 'object' && reason !== null && 'stack' in reason) {
    return String((reason as { stack?: unknown }).stack);
  }
  return String(reason);
}

function emit(message: string): void {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      // A failing listener must not turn one failure into two.
    }
  }
}

export function onRendererError(listener: ErrorListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let installed = false;

export function reportErrors() {
  if (installed) {
    return; // The window listeners are global state; installing twice stacks duplicates.
  }
  installed = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    console.error('[unhandled rejection]', describe(reason));
    emit(`unexpected failure: ${describe(reason).split('\n')[0]}`);
  });
  window.addEventListener('error', (event) => {
    console.error('[uncaught]', event.error?.stack ?? event.message);
    emit(`unexpected failure: ${event.error?.message ?? event.message}`);
  });
}
