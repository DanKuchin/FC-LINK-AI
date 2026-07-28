import { deriveStream } from '../rng/index.js';

export interface PersonalityInput {
  readonly masterSeed: string;
  readonly playerId: number | string;
  readonly age: number;
  readonly currentAbility: number;
  readonly potential: number;
  /** FC's international-reputation band, normalised to 0–5 by the importer. */
  readonly internationalReputation: number;
  readonly contractYearsRemaining: number;
}

export interface PersonalityTraits {
  readonly professionalism: number;
  readonly ambition: number;
  readonly loyalty: number;
  readonly consistency: number;
  readonly pressure: number;
}

export interface GeneratedPersonality {
  readonly traits: PersonalityTraits;
  readonly derivationSeed: string;
  readonly explanations: Readonly<Record<keyof PersonalityTraits, string>>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function trait(
  input: PersonalityInput,
  name: keyof PersonalityTraits,
  base: number,
): number {
  const rng = deriveStream({
    masterSeed: input.masterSeed,
    tick: 0,
    stream: `personality.${name}.v1`,
    entityId: input.playerId,
  });
  return Math.round(clamp(base + rng.gaussian(0, 9), 1, 100));
}

function validate(input: PersonalityInput): void {
  for (const [name, value] of Object.entries(input)) {
    if (name === 'masterSeed' || name === 'playerId') continue;
    if (!Number.isFinite(value)) throw new Error(`personality ${name} must be finite`);
  }
  if (input.masterSeed.length === 0) throw new Error('personality masterSeed is required');
}

/**
 * Produces the MVP's five hidden traits from facts the user already recognises.
 * Noise adds variation, but it is deliberately smaller than the visible-data
 * signal and each trait owns an independent stream.
 */
export function generatePersonality(input: PersonalityInput): GeneratedPersonality {
  validate(input);
  const age = clamp(input.age, 15, 45);
  const gap = clamp(input.potential - input.currentAbility, 0, 35);
  const reputation = clamp(input.internationalReputation, 0, 5);
  const contract = clamp(input.contractYearsRemaining, 0, 6);
  const experience = clamp(age - 18, 0, 18);

  const traits: PersonalityTraits = {
    professionalism: trait(
      input,
      'professionalism',
      43 + experience * 1.15 + reputation * 3,
    ),
    ambition: trait(
      input,
      'ambition',
      42 + gap * 1.15 + reputation * 4 - Math.max(0, age - 32) * 1.4,
    ),
    loyalty: trait(
      input,
      'loyalty',
      42 + contract * 5 + experience * 0.55 - gap * 0.25,
    ),
    consistency: trait(
      input,
      'consistency',
      40 + experience * 1.3 + reputation * 2.5,
    ),
    pressure: trait(
      input,
      'pressure',
      38 + experience * 0.75 + reputation * 7,
    ),
  };

  return {
    traits,
    derivationSeed: `personality:v1:${input.masterSeed}:${String(input.playerId)}`,
    explanations: {
      professionalism:
        `Age ${age} and reputation ${reputation}/5 set the professionalism baseline; ` +
        'seeded career variation supplies the remainder.',
      ambition:
        `The ${gap}-point potential gap and reputation ${reputation}/5 drive ambition; ` +
        'late-career age moderates it.',
      loyalty:
        `${contract.toFixed(1)} contract years and career experience support loyalty; ` +
        'a large unrealised ceiling pulls the other way.',
      consistency:
        `Career experience (${experience} years beyond age 18) and reputation ` +
        'set the consistency baseline.',
      pressure:
        `International reputation ${reputation}/5 is the strongest pressure signal, ` +
        'with experience adding stability.',
    },
  };
}
