import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BEAT_SORT,
  isBeatSortMode,
  sortBeats,
  type BeatSortMode,
  type BeatSummary,
} from '../../shared/beatSorting';

type Draft = { kind: 'create' } | { kind: 'rename'; from: string } | { kind: 'confirm-delete'; name: string };
type BeatInput = BeatSummary | string;
type Menu = { name: string; left: number; top: number };
type MenuAction = 'clone' | 'rename' | 'delete' | 'create';

type Props = {
  beats: BeatInput[];
  open: string | undefined;
  dirty: boolean;
  error: string | undefined;
  sortMode: BeatSortMode;
  manualOrder: string[];
  onOpen: (name: string) => void;
  onCreate: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onRemove: (name: string) => void;
  onClone: (name: string) => void;
  onSortChange: (mode: BeatSortMode) => void;
  onReorder: (from: string, to: string, position?: 'before' | 'after') => void;
  onDismissError: () => void;
};

/**
 * Naming happens in the tree, in a row that looks like the row it will become.
 *
 * It used to happen in window.prompt, which throws outright under Electron:
 * "prompt() is not supported". The throw landed in an async click handler and
 * went nowhere, so new and rename did nothing at all while delete, which uses
 * the supported window.confirm, kept working.
 */
export function FileTree({
  beats,
  open,
  dirty,
  error,
  sortMode = DEFAULT_BEAT_SORT,
  manualOrder = [],
  onOpen,
  onCreate,
  onRename,
  onRemove,
  onClone,
  onSortChange,
  onReorder,
  onDismissError,
}: Props) {
  const [draft, setDraft] = useState<Draft>();
  const [value, setValue] = useState('');
  const [menu, setMenu] = useState<Menu>();
  const input = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragged = useRef<string | undefined>(undefined);

  const beatSummaries = beats.map((beat) => (typeof beat === 'string' ? { name: beat, modifiedAt: 0 } : beat));
  const orderedBeats = sortBeats(beatSummaries, sortMode, manualOrder);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [draft]);

  const begin = useCallback(
    (next: Draft) => {
      setMenu(undefined);
      onDismissError();
      setDraft(next);
      setValue(next.kind === 'rename' ? next.from.replace(/\.js$/, '') : '');
    },
    [onDismissError],
  );

  const openMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, name: string) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 170;
    const left = Math.min(Math.max(event.clientX, 4), Math.max(4, window.innerWidth - menuWidth));
    setMenu({ name, left, top: Math.max(event.clientY, 4) });
  }, []);

  const choose = useCallback(
    (action: MenuAction) => {
      if (!menu) {
        return;
      }
      const name = menu.name;
      setMenu(undefined);
      switch (action) {
        case 'clone':
          onClone(name);
          return;
        case 'rename':
          begin({ kind: 'rename', from: name });
          return;
        case 'delete':
          begin({ kind: 'confirm-delete', name });
          return;
        case 'create':
          begin({ kind: 'create' });
          return;
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
    [begin, menu, onClone],
  );

  useEffect(() => {
    if (!menu) {
      return;
    }
    menuRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !menuRef.current?.contains(target)) {
        setMenu(undefined);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(undefined);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (draft || event.defaultPrevented || event.isComposing) {
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        begin({ kind: 'create' });
      } else if (event.key === 'F2' && open) {
        event.preventDefault();
        begin({ kind: 'rename', from: open });
      } else if (event.metaKey && event.key === 'Backspace' && open) {
        event.preventDefault();
        begin({ kind: 'confirm-delete', name: open });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [begin, draft, open]);

  function commit() {
    if (!draft) {
      return;
    }
    const name = value.trim();
    setDraft(undefined);
    if (!name) {
      return;
    }
    if (draft.kind === 'create') {
      onCreate(name);
    } else if (draft.kind === 'rename' && name !== draft.from.replace(/\.js$/, '')) {
      onRename(draft.from, name);
    }
  }

  const editor = (
    <input
      ref={input}
      className="tree-input"
      value={value}
      placeholder="name"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        } else if (event.key === 'Escape') {
          setDraft(undefined);
        }
      }}
    />
  );

  return (
    <section className="pane">
      <header className="pane-title">
        <span>[ beats ]</span>
        <span>
          <label className="tree-sort">
            <span>sort</span>
            <select
              aria-label="Sort beats"
              value={sortMode}
              onChange={(event) => {
                if (isBeatSortMode(event.target.value)) {
                  onSortChange(event.target.value);
                }
              }}
            >
              <option value="chronological">Newest first</option>
              <option value="alphabetical">Name A–Z</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <span className="tree-shortcuts">⌘N new · F2 rename · ⌘⌫ delete</span>
        </span>
      </header>
      <div className="pane-body">
        {orderedBeats.length === 0 && !draft && <p className="tree-empty">no beats yet</p>}
        {orderedBeats.map((beat, index) => {
          const name = beat.name;
          const displayName = name.replace(/\.js$/, '');
          const deletePending = draft?.kind === 'confirm-delete' && draft.name === name;
          const previous = orderedBeats[index - 1]?.name;
          const next = orderedBeats[index + 1]?.name;
          return draft?.kind === 'rename' && draft.from === name ? (
            <div key={name} className="tree-row">
              <div className="tree-item">{editor}</div>
            </div>
          ) : (
            <div
              key={name}
              className="tree-row"
              draggable={sortMode === 'manual'}
              onContextMenu={(event) => openMenu(event, name)}
              onDragStart={() => {
                dragged.current = name;
              }}
              onDragOver={(event) => {
                if (sortMode === 'manual') {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (sortMode === 'manual') {
                  const from = dragged.current;
                  if (from && from !== name) {
                    const fromIndex = orderedBeats.findIndex((beat) => beat.name === from);
                    const targetIndex = orderedBeats.findIndex((beat) => beat.name === name);
                    onReorder(from, name, fromIndex < targetIndex ? 'after' : 'before');
                  }
                }
                dragged.current = undefined;
              }}
              onDragEnd={() => {
                dragged.current = undefined;
              }}
            >
              <button
                className="tree-item"
                aria-label={name}
                aria-current={name === open}
                aria-keyshortcuts={sortMode === 'manual' ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                data-dirty={name === open && dirty}
                title={sortMode === 'manual' ? 'Alt+ArrowUp/Down to reorder' : undefined}
                onKeyDown={(event) => {
                  if (sortMode !== 'manual' || !event.altKey) {
                    return;
                  }
                  if (event.key === 'ArrowUp' && previous) {
                    event.preventDefault();
                    onReorder(name, previous);
                  } else if (event.key === 'ArrowDown' && next) {
                    event.preventDefault();
                    onReorder(name, next, 'after');
                  }
                }}
                onClick={() => onOpen(name)}
              >
                {sortMode === 'manual' && (
                  <span className="tree-drag-handle" aria-hidden="true">
                    ⠿
                  </span>
                )}
                <span className="dot">●</span>
                <span>{displayName}</span>
              </button>
              {deletePending && (
                <p className="tree-confirm">
                  <span>delete {displayName}?</span>
                  <button
                    onClick={() => {
                      const deletedName = draft.name;
                      setDraft(undefined);
                      onRemove(deletedName);
                    }}
                  >
                    delete
                  </button>
                  <button onClick={() => setDraft(undefined)}>keep</button>
                </p>
              )}
            </div>
          );
        })}
        {draft?.kind === 'create' && <div className="tree-item">{editor}</div>}
        {menu && (
          <div
            ref={menuRef}
            className="tree-menu"
            role="menu"
            aria-label={`Beat actions for ${menu.name}`}
            tabIndex={-1}
            style={{ left: `${menu.left}px`, top: `${menu.top}px` }}
          >
            <div className="tree-menu-title">{menu.name}</div>
            <button role="menuitem" onClick={() => choose('clone')}>
              clone
            </button>
            <button role="menuitem" onClick={() => choose('rename')}>
              rename
            </button>
            <button role="menuitem" onClick={() => choose('delete')}>
              delete
            </button>
            <button role="menuitem" onClick={() => choose('create')}>
              add new beat
            </button>
          </div>
        )}
        {error && (
          <p className="tree-error" onClick={onDismissError}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
