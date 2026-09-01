import { describe, expect, it, vi } from 'vitest';
import { installMasterTap } from './masterTap';

class FakeDestination {
  constructor(public context: object) {}
}

/** Records what each node was connected to, through the patched prototype. */
function harness() {
  const calls: { from: object; to: unknown }[] = [];
  const proto = {
    connect(this: object, target: unknown) {
      calls.push({ from: this, to: target });
      return target;
    },
  };
  const analysers: object[] = [];
  const taps = installMasterTap({
    proto,
    isDestination: (target) => target instanceof FakeDestination,
    contextOf: (target) => (target as FakeDestination).context,
    createAnalyser: () => {
      const analyser = { id: analysers.length };
      analysers.push(analyser);
      return analyser;
    },
  });
  return { calls, proto, taps, analysers };
}

describe('installMasterTap', () => {
  it('also connects to a tap when a node reaches the destination', () => {
    // The engine that actually makes sound connects straight to
    // AudioContext.destination, so tapping any single gain node inside
    // superdough misses it and the meters read silence while music plays.
    const { calls, proto, analysers } = harness();
    const context = {};
    const destination = new FakeDestination(context);
    const source = {};

    proto.connect.call(source, destination);

    expect(analysers).toHaveLength(1);
    expect(calls.map((call) => call.to)).toEqual([destination, analysers[0]]);
  });

  it('leaves ordinary connections alone', () => {
    const { calls, proto, analysers } = harness();
    const filter = {};
    proto.connect.call({}, filter);
    expect(analysers).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it('reuses one tap per audio context', () => {
    const { proto, analysers } = harness();
    const context = {};
    proto.connect.call({}, new FakeDestination(context));
    proto.connect.call({}, new FakeDestination(context));
    expect(analysers).toHaveLength(1);
  });

  it('taps each audio context separately', () => {
    const { proto, analysers } = harness();
    proto.connect.call({}, new FakeDestination({}));
    proto.connect.call({}, new FakeDestination({}));
    expect(analysers).toHaveLength(2);
  });

  it('exposes the taps so the meters can read them', () => {
    const { proto, taps, analysers } = harness();
    const context = {};
    proto.connect.call({}, new FakeDestination(context));
    expect(taps.get(context)).toBe(analysers[0]);
  });

  it('returns whatever the original connect returned', () => {
    const { proto } = harness();
    const destination = new FakeDestination({});
    expect(proto.connect.call({}, destination)).toBe(destination);
  });

  it('still connects the node when tapping fails', () => {
    // A tap is a nicety. Losing it must never cost the audio.
    const calls: unknown[] = [];
    const proto = {
      connect(this: object, target: unknown) {
        calls.push(target);
        return target;
      },
    };
    installMasterTap({
      proto,
      isDestination: () => true,
      contextOf: () => ({}),
      createAnalyser: () => {
        throw new Error('no analyser today');
      },
    });
    const destination = {};
    expect(() => proto.connect.call({}, destination)).not.toThrow();
    expect(calls).toEqual([destination]);
  });

  it('patches the prototype only once', () => {
    const proto = { connect: vi.fn() };
    const deps = {
      proto,
      isDestination: () => false,
      contextOf: () => ({}),
      createAnalyser: () => ({}),
    };
    const first = installMasterTap(deps);
    expect(installMasterTap(deps)).toBe(first);
  });
});
