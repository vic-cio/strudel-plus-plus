// Vite's `?raw` suffix inlines a file's contents as a string at build time;
// bare TypeScript has no declaration for it.
declare module '*?raw' {
  const content: string;
  export default content;
}
