import { tags as t } from '@lezer/highlight';
import { createTheme } from '@strudel/codemirror/themes/theme-helper.mjs';

/**
 * The editor half of the app palette, kept in step with theme.css by hand.
 *
 * Strudel picks a theme by name out of its own registry, so this registers into
 * that registry rather than passing an extension around. `settings` is the half
 * that becomes `:root` CSS variables and the pattern-highlight colours.
 */
export const deadeyeSettings = {
  light: false,
  background: '#3a251d',
  lineBackground: '#3a251d99',
  foreground: '#efe7d3',
  muted: '#efe7d350',
  caret: '#e0a83c',
  selection: '#5a3b2899',
  selectionMatch: '#5a3b2899',
  lineHighlight: '#2f1d16',
  gutterBackground: '#3a251d',
  gutterForeground: '#9c8462',
  gutterBorder: 'transparent',
};

export const deadeyeTheme = createTheme({
  theme: 'dark',
  settings: deadeyeSettings,
  styles: [
    { tag: t.keyword, color: '#e2643c' },
    { tag: [t.name, t.deleted, t.character, t.macroName], color: '#efe7d3' },
    { tag: [t.propertyName, t.function(t.variableName)], color: '#e0a83c' },
    { tag: [t.string, t.special(t.string)], color: '#adb56d' },
    { tag: [t.number, t.bool, t.null], color: '#e8b98a' },
    { tag: [t.definitionKeyword, t.modifier], color: '#e2643c' },
    { tag: [t.className, t.typeName], color: '#d9a86a' },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#a3805c' },
    { tag: [t.comment, t.blockComment, t.lineComment], color: '#9c8462', fontStyle: 'italic' },
    { tag: t.invalid, color: '#e2643c' },
  ],
});
