// The strudel packages are plain .mjs with no bundled types. These declarations
// cover only what this app calls, so a typo in a call site is still caught.
declare module '@strudel/codemirror' {
  export class StrudelMirror {
    constructor(options: Record<string, unknown>);
    code: string;
    repl: { setCps(cps: number): void; scheduler?: { cps?: number } };
    setCode(code: string): void;
    setTheme(name: string): void;
    setFontFamily(family: string): void;
    evaluate(autostart?: boolean): Promise<void>;
    toggle(): Promise<void>;
    stop(): Promise<void>;
    clear(): void;
  }
  export const themes: Record<string, unknown>;
  export const settings: Record<string, unknown>;
  export function activateTheme(name: string): void;
}
declare module '@strudel/codemirror/themes/theme-helper.mjs' {
  export function createTheme(spec: Record<string, unknown>): unknown;
}
declare module '@lezer/highlight' {
  export const tags: Record<string, unknown>;
}
declare module '@strudel/core' {
  export const silence: unknown;
  export function evalScope(...modules: unknown[]): Promise<unknown>;
  export function getPerformanceTimeSeconds(): number;
}
declare module '@strudel/draw' {
  export function getDrawContext(): CanvasRenderingContext2D;
}
declare module '@strudel/transpiler' {
  export const transpiler: unknown;
}
declare module '@strudel/tonal';
declare module '@strudel/mini';
declare module '@strudel/xen';
declare module '@strudel/hydra';
declare module '@strudel/soundfonts';
declare module '@strudel/motion';
declare module '@strudel/mondo';
declare module '@strudel/webaudio' {
  export const webaudioOutput: unknown;
  export function getAudioContextCurrentTime(): number;
  export function initAudioOnFirstClick(options?: Record<string, unknown>): Promise<void>;
  export function getAudioContext(): AudioContext;
  export function getAnalyzerData(type: 'time' | 'frequency', id: string | number): Float32Array;
  export const analysers: Record<string, AnalyserNode>;
  export function getSuperdoughAudioController(): { output?: { destinationGain?: AudioNode } } | undefined;
}
declare module 'worker-timers' {
  export function setInterval(handler: () => void, ms: number): number;
  export function clearInterval(id: number): void;
}
// The external compatibility modules are plain .mjs files without types.
declare module '@strudel/dough';
declare module '@strudel/edo';
declare module '@strudel/tidal';
declare module '@strudel/osc/osc.mjs' {
  export function parseControlsFromHap(hap: unknown, cps: number): Record<string, unknown>;
}
declare module './oscBridge.mjs';
declare module './midiBridge.mjs';
declare module 'vite-plugin-bundle-audioworklet' {
  const bundleAudioWorklet: () => unknown;
  export default bundleAudioWorklet;
}
