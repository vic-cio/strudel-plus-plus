import { describe, expect, it, vi } from 'vitest';
import { tokenAtEditorPoint, type EditorTokenSource } from './editorToken';

function editorWithWord(word: string | undefined): EditorTokenSource {
  return {
    posAtCoords: vi.fn(() => 8),
    state: {
      wordAt: vi.fn(() => (word === undefined ? null : { from: 5, to: 5 + word.length })),
      doc: { sliceString: vi.fn(() => word ?? '') },
    },
  };
}

describe('tokenAtEditorPoint', () => {
  it('resolves the document word under the pointer through the editor position APIs', () => {
    const editor = editorWithWord('gain');

    expect(tokenAtEditorPoint(editor, { x: 140, y: 90 })).toEqual({ text: 'gain', offset: 8 });
    expect(editor.posAtCoords).toHaveBeenCalledWith({ x: 140, y: 90 });
    expect(editor.state.wordAt).toHaveBeenCalledWith(8);
    expect(editor.state.doc.sliceString).toHaveBeenCalledWith(5, 9);
  });

  it('returns no token outside the document or between words', () => {
    const outside = editorWithWord('gain');
    outside.posAtCoords = vi.fn(() => null);
    expect(tokenAtEditorPoint(outside, { x: -1, y: -1 })).toBeUndefined();
    expect(tokenAtEditorPoint(editorWithWord(undefined), { x: 140, y: 90 })).toBeUndefined();
  });
});
