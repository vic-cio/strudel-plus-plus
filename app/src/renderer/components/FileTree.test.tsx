// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';
import { moveBeat } from '../../shared/beatSorting';

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof FileTree>[0]> = {}) {
  const props = {
    beats: ['canary.js'],
    open: 'canary.js',
    dirtyByBeat: {},
    error: undefined,
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onDismissError: vi.fn(),
    sortMode: 'chronological' as const,
    manualOrder: [],
    onSortChange: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(<FileTree {...props} />);
  return { props, user: userEvent.setup() };
}

describe('FileTree', () => {
  it('opens a naming row when new beat is clicked', async () => {
    // The whole point of this file. Twice now the sidebar has shipped with
    // these two buttons doing nothing at all, and neither time could it be
    // caught without a person clicking them.
    const { user } = setup();
    await user.click(screen.getByTitle('New beat'));
    expect(screen.getByPlaceholderText('name')).toBeDefined();
  });

  it('reports the typed name when the naming row is confirmed', async () => {
    const { props, user } = setup();
    await user.click(screen.getByTitle('New beat'));
    await user.type(screen.getByPlaceholderText('name'), 'breakbeat{Enter}');
    expect(props.onCreate).toHaveBeenCalledWith('breakbeat');
  });

  it('prefills the rename row with the open beat, without its extension', async () => {
    const { user } = setup();
    await user.click(screen.getByTitle('Rename'));
    expect(screen.getByPlaceholderText('name')).toHaveProperty('value', 'canary');
  });

  it('reports a rename with the old and the new name', async () => {
    const { props, user } = setup();
    await user.click(screen.getByTitle('Rename'));
    const input = screen.getByPlaceholderText('name');
    await user.clear(input);
    await user.type(input, 'renamed{Enter}');
    expect(props.onRename).toHaveBeenCalledWith('canary.js', 'renamed');
  });

  it('does not report a rename that changed nothing', async () => {
    const { props, user } = setup();
    await user.click(screen.getByTitle('Rename'));
    await user.type(screen.getByPlaceholderText('name'), '{Enter}');
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('abandons the naming row on escape', async () => {
    const { props, user } = setup();
    await user.click(screen.getByTitle('New beat'));
    await user.type(screen.getByPlaceholderText('name'), 'nope{Escape}');
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('name')).toBeNull();
  });

  it('asks before deleting, and deletes once confirmed', async () => {
    const { props, user } = setup();
    await user.click(screen.getByTitle('Delete'));
    expect(props.onRemove).not.toHaveBeenCalled();
    await user.click(screen.getByText('delete'));
    expect(props.onRemove).toHaveBeenCalledWith('canary.js');
  });

  it('keeps the beat when the deletion is declined', async () => {
    const { props, user } = setup();
    await user.click(screen.getByTitle('Delete'));
    await user.click(screen.getByText('keep'));
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it('renders the delete confirmation directly below the beat it belongs to', async () => {
    const { user } = setup({ beats: ['first.js', 'canary.js', 'last.js'] });

    await user.click(screen.getByTitle('Delete'));

    const beat = screen.getByRole('button', { name: /canary/ });
    const confirmation = screen.getByText('delete canary?').closest('.tree-confirm');
    expect(confirmation?.previousElementSibling).toBe(beat);
  });

  it('offers the three beat sort modes with chronological order as the default', () => {
    setup();

    const sort = screen.getByLabelText('Sort beats');
    expect(sort).toHaveProperty('value', 'chronological');
    expect(screen.getByRole('option', { name: 'Newest first' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Name A–Z' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Manual' })).toBeDefined();
  });

  it('reports a manual drag from one beat onto another in the drop direction', () => {
    const { props } = setup({
      sortMode: 'manual',
      manualOrder: ['canary.js', 'other.js'],
      beats: ['canary.js', 'other.js'],
    });
    const from = screen.getByRole('button', { name: 'canary.js' });
    const to = screen.getByRole('button', { name: 'other.js' });

    fireEvent.dragStart(from);
    fireEvent.dragOver(to);
    fireEvent.drop(to);

    expect(props.onReorder).toHaveBeenCalledWith('canary.js', 'other.js', 'after');
    const [dragged, target, position] = (props.onReorder as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(moveBeat({ order: ['canary.js', 'other.js'], from: dragged, to: target, position })).toEqual([
      'other.js',
      'canary.js',
    ]);
  });

  it('supports keyboard reordering without rendering bulky move controls', () => {
    const { props } = setup({
      sortMode: 'manual',
      manualOrder: ['canary.js', 'other.js'],
      beats: ['canary.js', 'other.js'],
    });

    const canary = screen.getByRole('button', { name: 'canary.js' });
    fireEvent.keyDown(canary, { key: 'ArrowDown', altKey: true });

    expect(props.onReorder).toHaveBeenCalledWith('canary.js', 'other.js', 'after');
    expect(screen.queryByRole('button', { name: 'Move canary.js up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move canary.js down' })).toBeNull();
  });

  it('shows a failure from the store', () => {
    setup({ error: 'renamed.js already exists.' });
    expect(screen.getByText('renamed.js already exists.')).toBeDefined();
  });
});
