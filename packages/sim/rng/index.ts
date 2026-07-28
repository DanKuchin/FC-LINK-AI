/**
 * Deterministic random number generation.  (Ticket 16)
 *
 * Determinism is not a nice-to-have here. It underwrites three separate
 * promises: that a save reloads to the same world, that a bug is reproducible
 * from a seed, and that the game can explain why something happened.
 *
 * Rules this module exists to enforce:
 *   1. There is no global RNG. Every draw comes from a stream derived from
 *      (masterSeed, tick, streamId, entityId).
 *   2. State is integer-only (uint32 lanes). No floats in the state, so results
 *      are identical on every platform and every Node version.
 *   3. Nothing here reads the clock, the environment, or Math.random.
 *
 * Algorithm: xoshiro128** seeded by splitmix32. Small, fast, well-distributed,
 * and short enough to be audited by one person — which matters more than
 * cryptographic quality for a football simulation.
 */

const TWO_POW_32 = 0x1_0000_0000;
const TWO_POW_24 = 0x100_0000;

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** FNV-1a, 32-bit. Used to turn a stream description into a seed. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** splitmix32 — expands one uint32 into a well-mixed sequence, used for seeding. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export interface WeightedOption<T> {
  readonly value: T;
  readonly weight: number;
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** How many raw draws this stream has produced. Useful in dev logs and tests. */
  private drawCount = 0;

  readonly label: string;

  constructor(seed: number | string, label = 'unlabelled') {
    const numeric = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    const next = splitmix32(numeric);
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    this.label = label;
    // An all-zero state is a fixed point for xoshiro; splitmix makes it
    // vanishingly unlikely, but "vanishingly unlikely" is not "impossible".
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

  get draws(): number {
    return this.drawCount;
  }

  /** Raw draw: a uniform uint32. Everything else is built on this. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);

    this.drawCount += 1;
    return result;
  }

  /** Uniform float in [0, 1). 24 bits of mantissa — exactly representable. */
  next(): number {
    return (this.nextUint32() >>> 8) / TWO_POW_24;
  }

  /**
   * Uniform integer in [min, max], both inclusive.
   * Uses rejection sampling: modulo alone biases low values, and a football
   * economy compounds small biases over a decade of simulated seasons.
   */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new TypeError(`Rng.int requires integers, got (${min}, ${max})`);
    }
    if (max < min) throw new RangeError(`Rng.int: max ${max} < min ${min}`);
    const range = max - min + 1;
    if (range === 1) return min;
    if (range > TWO_POW_32) throw new RangeError('Rng.int range exceeds 2^32');

    const limit = TWO_POW_32 - (TWO_POW_32 % range);
    let draw = this.nextUint32();
    while (draw >= limit) draw = this.nextUint32();
    return min + (draw % range);
  }

  /** True with probability `p`. p <= 0 never fires; p >= 1 always does. */
  bool(p = 0.5): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick on an empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /**
   * Weighted choice. Zero and negative weights are ignored rather than throwing:
   * balance data is authored by hand and a zeroed-out option is a legitimate way
   * to disable something.
   */
  weightedPick<T>(options: readonly WeightedOption<T>[]): T {
    let total = 0;
    for (const o of options) if (o.weight > 0) total += o.weight;
    if (total <= 0) throw new RangeError('Rng.weightedPick: no option has a positive weight');

    let roll = this.next() * total;
    for (const o of options) {
      if (o.weight <= 0) continue;
      roll -= o.weight;
      if (roll < 0) return o.value;
    }
    // Only reachable through floating-point drift at the very top of the range.
    for (let i = options.length - 1; i >= 0; i -= 1) {
      const o = options[i] as WeightedOption<T>;
      if (o.weight > 0) return o.value;
    }
    throw new RangeError('Rng.weightedPick: unreachable');
  }

  /** Fisher–Yates. Returns a new array; the input is not touched. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /**
   * Normal distribution via Box–Muller.
   *
   * Deliberately does NOT cache the second variate. Caching would make the
   * number of raw draws depend on call history, which makes divergence between
   * two runs much harder to locate. One gaussian costs two draws, always.
   */
  gaussian(mean = 0, stdDev = 1): number {
    let u = this.next();
    while (u === 0) u = this.next(); // log(0) is not a number we want
    const v = this.next();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    return mean + stdDev * magnitude * Math.cos(2 * Math.PI * v);
  }

  /** Gaussian clamped to a range, for attributes and other bounded quantities. */
  gaussianClamped(mean: number, stdDev: number, min: number, max: number): number {
    const value = this.gaussian(mean, stdDev);
    return value < min ? min : value > max ? max : value;
  }
}

export interface StreamKey {
  /** `careers.master_seed` — the root of the whole career's determinism. */
  readonly masterSeed: string;
  /** Which simulated day this is. Included so the same stream differs per tick. */
  readonly tick: number;
  /** What the stream is for, e.g. 'injury', 'board.mood', 'transfer.interest'. */
  readonly stream: string;
  /** Optional subject, so two players on the same day draw independently. */
  readonly entityId?: number | string;
}

/**
 * The only sanctioned way to obtain randomness.
 *
 * Two calls with the same key return two generators that produce the same
 * sequence — so a system can be re-run, in a test or after a reload, and land
 * in exactly the same place.
 */
export function deriveStream(key: StreamKey): Rng {
  const entity = key.entityId ?? '';
  const label = `${key.stream}@${key.tick}${entity === '' ? '' : `:${entity}`}`;
  return new Rng(`${key.masterSeed}|${key.tick}|${key.stream}|${entity}`, label);
}

/** Convenience for a single tick: `streams(seed, 42).for('injury', playerId)`. */
export function streams(masterSeed: string, tick: number) {
  return {
    masterSeed,
    tick,
    for(stream: string, entityId?: number | string): Rng {
      return deriveStream(
        entityId === undefined ? { masterSeed, tick, stream } : { masterSeed, tick, stream, entityId },
      );
    },
  };
}

/**
 * Generates a master seed for a new career.
 *
 * This is the one place in the simulation permitted to be non-deterministic,
 * and it happens exactly once per career. Callers may pass their own seed to
 * make even that reproducible.
 */
export function createMasterSeed(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
