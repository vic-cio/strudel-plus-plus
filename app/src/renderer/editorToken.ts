export type EditorTokenSource = {
  posAtCoords(point: { x: number; y: number }): number | null;
  state: {
    wordAt(position: number): { from: number; to: number } | null;
    doc: { sliceString(from: number, to: number): string };
  };
};

export type EditorToken = { text: string; offset: number };

/** Resolve the document word at viewport coordinates without moving the caret. */
export function tokenAtEditorPoint(
  editor: EditorTokenSource,
  point: { x: number; y: number },
): EditorToken | undefined {
  const position = editor.posAtCoords(point);
  if (position === null) return undefined;
  const word = editor.state.wordAt(position);
  if (!word) return undefined;
  const token = editor.state.doc.sliceString(word.from, word.to);
  return token.length > 0 ? { text: token, offset: position } : undefined;
}
