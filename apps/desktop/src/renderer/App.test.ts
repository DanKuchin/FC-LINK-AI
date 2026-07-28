import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SquadPlayerView, SquadView } from '../shared/ipc.js';
import {
  Squad,
  sortSquadPlayers,
  type SquadSortKey,
} from './App.js';

const players: readonly SquadPlayerView[] = [
  {
    id: 1,
    name: 'Zed Striker',
    position: 'ST',
    age: 31,
    abilityLow: 70,
    abilityHigh: 74,
    potentialLow: 70,
    potentialHigh: 75,
    fitness: 91,
    form: null,
    morale: null,
    contractEnd: 21_000,
    squadRole: 'important',
    wage: null,
    wageEstimated: false,
    personality: {
      professionalism: 60,
      ambition: 70,
      loyalty: 50,
      consistency: 55,
      pressure: 65,
      seed: 'player:1',
    },
  },
  {
    id: 2,
    name: 'Ada Keeper',
    position: 'GK',
    age: 22,
    abilityLow: null,
    abilityHigh: null,
    potentialLow: 80,
    potentialHigh: 86,
    fitness: 73,
    form: 68,
    morale: 74,
    contractEnd: 20_500,
    squadRole: null,
    wage: null,
    wageEstimated: false,
    personality: null,
  },
];

describe('Squad renderer contract', () => {
  it('renders career evidence with accessible sorting, density, and profile controls', () => {
    const data: SquadView = {
      source: 'career',
      clubName: 'Test United',
      currentDate: 20_000,
      players,
    };
    const html = renderToStaticMarkup(React.createElement(Squad, { data }));

    expect(html).toContain('Test United · career day 20000');
    expect(html).toContain('<caption class="sr-only">Managed first-team squad</caption>');
    expect(html.match(/aria-sort="/g)).toHaveLength(6);
    expect(html).toContain('<select>');
    expect(html).toContain('class="player-link" aria-pressed="true"');
    expect(html).toContain('class="player-profile" aria-live="polite"');
    expect(html).toContain('70–74');
    expect(html).not.toContain('Sample presentation data');
  });

  it('sorts every supported key in both directions without mutating source order', () => {
    const expectedAscending: Readonly<Record<SquadSortKey, readonly number[]>> = {
      name: [2, 1],
      position: [2, 1],
      age: [2, 1],
      ability: [2, 1],
      fitness: [2, 1],
      contract: [2, 1],
    };
    for (const key of Object.keys(expectedAscending) as SquadSortKey[]) {
      expect(sortSquadPlayers(players, key, true).map((player) => player.id))
        .toEqual(expectedAscending[key]);
      expect(sortSquadPlayers(players, key, false).map((player) => player.id))
        .toEqual([...expectedAscending[key]].reverse());
    }
    expect(players.map((player) => player.id)).toEqual([1, 2]);
  });
});
