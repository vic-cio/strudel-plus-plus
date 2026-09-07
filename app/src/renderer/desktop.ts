import type { DesktopApi } from '../preload/index';

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

export const desktop = new Proxy({} as DesktopApi, {
  get(_, prop) {
    if (typeof window === 'undefined' || !window.desktop) {
      throw new Error('desktop API not available');
    }
    const val = (window.desktop as any)[prop];
    return typeof val === 'function' ? val.bind(window.desktop) : val;
  },
});
