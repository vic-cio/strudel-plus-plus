import { useEffect, useRef } from 'react';

export type EditorMenuState = {
  x: number;
  y: number;
  functionName?: string;
};

type Props = {
  menu: EditorMenuState;
  playing: boolean;
  onToggle: () => void;
  onSpawn: (functionName: string) => void;
  onDismiss: () => void;
};

export function EditorContextMenu({ menu, playing, onToggle, onSpawn, onDismiss }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onDismiss]);

  const run = (action: () => void) => {
    onDismiss();
    action();
  };
  const spawnFunction = menu.functionName;

  return (
    <div
      ref={rootRef}
      className="editor-context-menu"
      role="menu"
      aria-label="Editor actions"
      style={{ left: menu.x, top: menu.y }}
    >
      <button role="menuitem" onClick={() => run(onToggle)}>
        {playing ? 'Stop music' : 'Start music'}
      </button>
      {spawnFunction !== undefined && (
        <button role="menuitem" onClick={() => run(() => onSpawn(spawnFunction))}>
          Spawn floating {spawnFunction} plugin
        </button>
      )}
    </div>
  );
}
