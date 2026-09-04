import { describe, expect, it, vi } from 'vitest';
import { installMasterTap, liveMasterStream, selectLiveTap } from './masterTap';

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

  it('connects every engine that reaches the destination to the recording stream', () => {
    // superdough's gain and the dough worklet reach AudioContext.destination
    // separately. Wiring only whichever connected first leaves the other
    // engine out of the exported take while the meters still show it.
    const calls: { from: object; to: unknown }[] = [];
    const proto = {
      connect(this: object, target: unknown) {
        calls.push({ from: this, to: target });
        return target;
      },
    };
    const stream = {} as MediaStream;
    const streamDestination = { stream };
    const analyser = { id: 'analyser' };
    const context = { state: 'running' };
    const taps = installMasterTap({
      proto,
      isDestination: (target) => target instanceof FakeDestination,
      contextOf: (target) => (target as FakeDestination).context,
      createAnalyser: () => analyser,
      createMediaStreamDestination: () => streamDestination,
    });
    const superdough = { id: 'superdough' };
    const worklet = { id: 'worklet' };

    proto.connect.call(superdough, new FakeDestination(context));
    proto.connect.call(worklet, new FakeDestination(context));

    expect(liveMasterStream(taps)).toBe(stream);
    for (const node of [superdough, worklet]) {
      expect(calls.filter((call) => call.from === node).map((call) => call.to)).toContain(streamDestination);
      expect(calls.filter((call) => call.from === node).map((call) => call.to)).toContain(analyser);
    }
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

describe('selectLiveTap', () => {
  it('returns the tap for a running context', () => {
    const running = { state: 'running' };
    const analyser = { id: 'a' };
    const taps = new Map<object, object>([[running, analyser]]);
    expect(selectLiveTap(taps)).toBe(analyser);
  });

  it('prefers a running context over one inserted later', () => {
    // A throwaway OfflineAudioContext (a bounce, a reverb impulse-response
    // render) connects to its own destination and gets tapped after the
    // real, live context. "Last inserted" must not win over "actually live".
    const live = { state: 'running' };
    const offline = { state: 'closed' };
    const liveAnalyser = { id: 'live' };
    const offlineAnalyser = { id: 'offline' };
    const taps = new Map<object, object>([
      [live, liveAnalyser],
      [offline, offlineAnalyser],
    ]);
    expect(selectLiveTap(taps)).toBe(liveAnalyser);
  });

  it('prunes a closed context out of the map', () => {
    const live = { state: 'running' };
    const offline = { state: 'closed' };
    const taps = new Map<object, object>([
      [live, { id: 'live' }],
      [offline, { id: 'offline' }],
    ]);
    selectLiveTap(taps);
    expect(taps.has(offline)).toBe(false);
    expect(taps.has(live)).toBe(true);
  });

  it('falls back to a suspended context when nothing is running', () => {
    const suspended = { state: 'suspended', resume: vi.fn() };
    const analyser = { id: 'suspended' };
    const taps = new Map<object, object>([[suspended, analyser]]);
    expect(selectLiveTap(taps)).toBe(analyser);
  });

  it('resumes a suspended context it falls back to', () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const suspended = { state: 'suspended', resume };
    const taps = new Map<object, object>([[suspended, { id: 'suspended' }]]);
    selectLiveTap(taps);
    expect(resume).toHaveBeenCalled();
  });

  it('does not throw when a suspended context has no resume method', () => {
    const suspended = { state: 'suspended' };
    const taps = new Map<object, object>([[suspended, { id: 'suspended' }]]);
    expect(() => selectLiveTap(taps)).not.toThrow();
  });

  it('returns undefined for an empty map', () => {
    expect(selectLiveTap(new Map())).toBeUndefined();
  });

  it('returns undefined when every context is closed', () => {
    const taps = new Map<object, object>([[{ state: 'closed' }, { id: 'a' }]]);
    expect(selectLiveTap(taps)).toBeUndefined();
  });
});
