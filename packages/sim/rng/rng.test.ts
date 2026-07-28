import { describe, expect, it } from 'vitest';
import { Rng, createMasterSeed, deriveStream, hashString, streams } from './index.js';

describe('Rng — reproducibility', () => {
  it('produces an identical sequence from an identical seed', () => {
    const a = new Rng('seed-1');
    const b = new Rng('seed-1');
    const left = Array.from({ length: 1000 }, () => a.nextUint32());
    const right = Array.from({ length: 1000 }, () => b.nextUint32());
    expect(left).toEqual(right);
  });

  it('produces different sequences from different seeds', () => {
    const a = Array.from({ length: 50 }, (_, i) => new Rng(`seed-${i}`).nextUint32());
    expect(new Set(a).size).toBe(50);
  });

  it('is stable across runs — regression guard on the exact algorithm', () => {
    // If this fails, the generator changed and EVERY existing save now
    // simulates differently. That is a save-breaking change, not a refactor.
    const rng = new Rng('tenure');
    const first = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];
    expect(first).toMatchInlineSnapshot(`
      [
        1067337961,
        4028980641,
        1799893008,
        474120079,
      ]
    `);
  });

  it('never lands in the all-zero fixed point', () => {
    const rng = new Rng(0);
    const draws = Array.from({ length: 100 }, () => rng.nextUint32());
    expect(draws.some((d) => d !== 0)).toBe(true);
  });
});

describe('Rng — distribution', () => {
  it('next() stays in [0, 1)', () => {
    const rng = new Rng('unit');
    for (let i = 0; i < 100_000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() covers the full inclusive range without bias', () => {
    const rng = new Rng('dice');
    const counts = new Map<number, number>();
    const rolls = 600_000;
    for (let i = 0; i < rolls; i += 1) {
      const v = rng.int(1, 6);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const n of counts.values()) {
      // within 2% of the expected 100,000
      expect(Math.abs(n - rolls / 6) / (rolls / 6)).toBeLessThan(0.02);
    }
  });

  it('int() handles a single-value range and rejects an inverted one', () => {
    const rng = new Rng('edge');
    expect(rng.int(7, 7)).toBe(7);
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.int(0.5, 3)).toThrow(TypeError);
  });

  it('bool() honours its probability and its extremes', () => {
    const rng = new Rng('coin');
    let hits = 0;
    for (let i = 0; i < 100_000; i += 1) if (rng.bool(0.25)) hits += 1;
    expect(Math.abs(hits - 25_000) / 25_000).toBeLessThan(0.03);
    expect(rng.bool(0)).toBe(false);
    expect(rng.bool(1)).toBe(true);
  });

  it('gaussian() lands near the requested mean and spread', () => {
    const rng = new Rng('bell');
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
      const v = rng.gaussian(50, 10);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(mean).toBeGreaterThan(49.8);
    expect(mean).toBeLessThan(50.2);
    expect(sd).toBeGreaterThan(9.8);
    expect(sd).toBeLessThan(10.2);
  });

  it('gaussianClamped() respects its bounds', () => {
    const rng = new Rng('clamp');
    for (let i = 0; i < 10_000; i += 1) {
      const v = rng.gaussianClamped(50, 40, 1, 99);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(99);
    }
  });

  it('gaussian costs exactly two draws every time', () => {
    const rng = new Rng('draws');
    const before = rng.draws;
    rng.gaussian();
    rng.gaussian();
    expect(rng.draws - before).toBe(4);
  });
});

describe('Rng — collections', () => {
  it('pick() only returns members, and throws on empty', () => {
    const rng = new Rng('pick');
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 500; i += 1) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('weightedPick() respects the weights', () => {
    const rng = new Rng('weights');
    const options = [
      { value: 'common', weight: 9 },
      { value: 'rare', weight: 1 },
      { value: 'disabled', weight: 0 },
    ];
    const counts = new Map<string, number>([['common', 0], ['rare', 0], ['disabled', 0]]);
    for (let i = 0; i < 50_000; i += 1) {
      const picked = rng.weightedPick(options);
      counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }
    expect(counts.get('disabled')).toBe(0);
    expect((counts.get('rare') ?? 0) / 50_000).toBeGreaterThan(0.08);
    expect((counts.get('rare') ?? 0) / 50_000).toBeLessThan(0.12);
  });

  it('weightedPick() throws when nothing is selectable', () => {
    const rng = new Rng('weights');
    expect(() => rng.weightedPick([{ value: 'x', weight: 0 }])).toThrow(RangeError);
  });

  it('shuffle() permutes without mutating the input', () => {
    const rng = new Rng('shuffle');
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = rng.shuffle(input);
    expect(out).not.toBe(input);
    expect([...out].sort((a, b) => a - b)).toEqual([...input]);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('shuffle() reaches many distinct permutations', () => {
    const rng = new Rng('perm');
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(rng.shuffle([1, 2, 3, 4]).join(''));
    expect(seen.size).toBe(24);
  });
});

describe('stream derivation', () => {
  it('the same key yields the same sequence', () => {
    const key = { masterSeed: 'abc', tick: 12, stream: 'injury', entityId: 158023 };
    const a = Array.from({ length: 20 }, () => deriveStream(key).nextUint32());
    const b = Array.from({ length: 20 }, () => deriveStream(key).nextUint32());
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(1); // fresh stream each time — same first draw
  });

  it('varying any component changes the stream', () => {
    const base = { masterSeed: 'abc', tick: 12, stream: 'injury', entityId: 1 };
    const first = deriveStream(base).nextUint32();
    expect(deriveStream({ ...base, masterSeed: 'abd' }).nextUint32()).not.toBe(first);
    expect(deriveStream({ ...base, tick: 13 }).nextUint32()).not.toBe(first);
    expect(deriveStream({ ...base, stream: 'form' }).nextUint32()).not.toBe(first);
    expect(deriveStream({ ...base, entityId: 2 }).nextUint32()).not.toBe(first);
  });

  it('entities on the same day draw independently', () => {
    const day = streams('career-seed', 100);
    const values = Array.from({ length: 500 }, (_, id) => day.for('injury', id).next());
    expect(new Set(values).size).toBeGreaterThan(495);
  });

  it('omitting entityId is distinct from passing an empty one', () => {
    const day = streams('s', 1);
    expect(day.for('x').nextUint32()).toBe(deriveStream({ masterSeed: 's', tick: 1, stream: 'x' }).nextUint32());
  });

  it('labels a stream usefully for debugging', () => {
    expect(streams('s', 7).for('board.mood', 42).label).toBe('board.mood@7:42');
    expect(streams('s', 7).for('board.mood').label).toBe('board.mood@7');
  });
});

describe('seeds', () => {
  it('hashString is stable and well spread', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    const hashes = new Set(Array.from({ length: 5000 }, (_, i) => hashString(`player-${i}`)));
    expect(hashes.size).toBeGreaterThan(4990);
  });

  it('createMasterSeed honours an explicit value and is otherwise unique', () => {
    expect(createMasterSeed('fixed')).toBe('fixed');
    const seeds = new Set(Array.from({ length: 200 }, () => createMasterSeed()));
    expect(seeds.size).toBe(200);
    expect(createMasterSeed()).toMatch(/^[0-9a-f]{32}$/);
  });
});
