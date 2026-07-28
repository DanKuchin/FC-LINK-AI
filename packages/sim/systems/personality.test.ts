import { describe, expect, it } from 'vitest';
import { generatePersonality, type PersonalityInput } from './personality.js';

const player: PersonalityInput = {
  masterSeed: 'career-seed',
  playerId: 42,
  age: 24,
  currentAbility: 72,
  potential: 84,
  internationalReputation: 2,
  contractYearsRemaining: 3,
};

describe('personality generation', () => {
  it('is stable across regeneration and keeps a traceable seed', () => {
    const first = generatePersonality(player);
    const second = generatePersonality(player);
    expect(second).toEqual(first);
    expect(first.derivationSeed).toBe('personality:v1:career-seed:42');
  });

  it('uses independent entity and trait streams', () => {
    const first = generatePersonality(player);
    const other = generatePersonality({ ...player, playerId: 43 });
    expect(other.traits).not.toEqual(first.traits);
    expect(new Set(Object.values(first.traits)).size).toBeGreaterThan(2);
  });

  it('keeps every trait bounded and every value explainable', () => {
    const generated = generatePersonality(player);
    for (const [name, value] of Object.entries(generated.traits)) {
      expect(value, name).toBeGreaterThanOrEqual(1);
      expect(value, name).toBeLessThanOrEqual(100);
      expect(generated.explanations[name as keyof typeof generated.traits].length)
        .toBeGreaterThan(40);
    }
  });

  it('lets visible facts dominate the population-level direction', () => {
    const prospects = Array.from({ length: 500 }, (_, playerId) =>
      generatePersonality({
        ...player,
        playerId,
        age: 19,
        currentAbility: 60,
        potential: 90,
        internationalReputation: 0,
        contractYearsRemaining: 1,
      }).traits);
    const veterans = Array.from({ length: 500 }, (_, index) =>
      generatePersonality({
        ...player,
        playerId: index + 1000,
        age: 34,
        currentAbility: 82,
        potential: 82,
        internationalReputation: 5,
        contractYearsRemaining: 4,
      }).traits);
    const mean = (values: readonly number[]) =>
      values.reduce((total, value) => total + value, 0) / values.length;

    expect(mean(prospects.map((traits) => traits.ambition)))
      .toBeGreaterThan(mean(veterans.map((traits) => traits.ambition)));
    expect(mean(veterans.map((traits) => traits.pressure)))
      .toBeGreaterThan(mean(prospects.map((traits) => traits.pressure)));
    expect(mean(veterans.map((traits) => traits.consistency)))
      .toBeGreaterThan(mean(prospects.map((traits) => traits.consistency)));
  });

  it('rejects incomplete numeric inputs instead of generating NaN traits', () => {
    expect(() => generatePersonality({ ...player, age: Number.NaN }))
      .toThrow(/age must be finite/);
  });
});
