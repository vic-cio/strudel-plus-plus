import { describe, expect, it, vi } from 'vitest';
import { handoffClonedBeat } from './cloneHandoff';

describe('handoffClonedBeat', () => {
  it('activates a clone without re-evaluating when audio is stopped', () => {
    const activate = vi.fn();
    const reevaluate = vi.fn();

    handoffClonedBeat({ playing: false, activate, reevaluate });

    expect(activate).toHaveBeenCalledOnce();
    expect(reevaluate).not.toHaveBeenCalled();
  });

  it('re-evaluates once when audio is already playing', () => {
    const activate = vi.fn();
    const reevaluate = vi.fn();

    handoffClonedBeat({ playing: true, activate, reevaluate });

    expect(activate).toHaveBeenCalledOnce();
    expect(reevaluate).toHaveBeenCalledOnce();
  });
});
