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

/** Land a failure in the error surface from inside the renderer itself — a
 * caught exception that never becomes an `unhandledrejection`/`error` event,
 * such as one a self-healing loop (the EQ's rAF chain) swallows to keep
 * running. */
export function reportError(reason: unknown, source = 'renderer'): void {
  console.error(`[${source}]`, describe(reason));
  emit(`unexpected failure: ${describe(reason).split('\n')[0]}`);
}

let installed = false;

export function reportErrors() {
  if (installed) {
    return; // The window listeners are global state; installing twice stacks duplicates.
  }
  installed = true;
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason, 'unhandled rejection'));
  window.addEventListener('error', (event) => reportError(event.error ?? event.message, 'uncaught'));
}
