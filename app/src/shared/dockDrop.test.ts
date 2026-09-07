import { describe, expect, it } from 'vitest';
import { dropFloatingPanel, resolveDockDropTarget } from './dockDrop';

const geometry = { x: 10, y: 10, width: 120, height: 80, zIndex: 1 };

describe('dock drop targeting', () => {
  it('targets only the split pane under the pointer', () => {
    expect(
      resolveDockDropTarget({
        x: 750,
        y: 540,
        panes: [
          { left: 0, right: 500, top: 500, bottom: 640 },
          { left: 500, right: 1000, top: 500, bottom: 640 },
        ],
      }),
    ).toEqual({ paneIndex: 1, side: 'right', autoSplit: false });
    expect(
      resolveDockDropTarget({
        x: 250,
        y: 540,
        panes: [
          { left: 0, right: 500, top: 500, bottom: 640 },
          { left: 500, right: 1000, top: 500, bottom: 640 },
        ],
      }),
    ).toEqual({ paneIndex: 0, side: 'left', autoSplit: false });
  });

  it('auto-splits a full-width pane and preserves the existing side', () => {
    const result = dropFloatingPanel(
      {
        split: false,
        panes: [{ tabs: ['eq'], active: 'eq' }],
        floating: [{ instanceId: 'mixer', geometry }],
      },
      'mixer',
      { paneIndex: 1, side: 'right', autoSplit: true },
    );

    expect(result.split).toBe(true);
    expect(result.panes).toEqual([
      { tabs: ['eq'], active: 'eq' },
      { tabs: ['mixer'], active: 'mixer' },
    ]);
    expect(result.floating).toBeUndefined();
  });
});
