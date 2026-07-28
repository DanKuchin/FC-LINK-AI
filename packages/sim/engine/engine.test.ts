import { describe, expect, it } from 'vitest';
import {
  advanceTo,
  type AdvanceStore,
  type CareerClock,
  type QueuedEvent,
} from './advance.js';
import {
  applyEffects,
  deterministicEventKey,
  type Effect,
  type SimEventDraft,
} from './effects.js';

interface Mutation {
  readonly amount: number;
}

class MemoryStore implements AdvanceStore<Mutation> {
  clock: CareerClock = {
    careerId: 1,
    currentDate: 20_000,
    tickIndex: 0,
    masterSeed: 'fixed-seed',
  };
  value = 0;
  readonly eventKeys = new Set<string>();
  readonly events: SimEventDraft[] = [];
  readonly queue: QueuedEvent[] = [];
  transactionCount = 0;

  transaction<T>(operation: () => T): T {
    this.transactionCount += 1;
    const before = {
      clock: this.clock,
      value: this.value,
      eventKeys: new Set(this.eventKeys),
      events: [...this.events],
      queue: [...this.queue],
    };
    try {
      return operation();
    } catch (error) {
      this.clock = before.clock;
      this.value = before.value;
      this.eventKeys.clear();
      for (const key of before.eventKeys) this.eventKeys.add(key);
      this.events.splice(0, this.events.length, ...before.events);
      this.queue.splice(0, this.queue.length, ...before.queue);
      throw error;
    }
  }

  readCareer(careerId: number): CareerClock {
    if (careerId !== this.clock.careerId) throw new Error('missing career');
    return this.clock;
  }

  dueEvents(careerId: number, day: number): readonly QueuedEvent[] {
    if (careerId !== this.clock.careerId) throw new Error('missing career');
    return this.queue.filter((event) => event.dueOn <= day);
  }

  consumeQueuedEvent(_careerId: number, eventKey: string): void {
    const index = this.queue.findIndex((event) => event.eventKey === eventKey);
    if (index >= 0) this.queue.splice(index, 1);
  }

  hasEvent(eventKey: string): boolean {
    return this.eventKeys.has(eventKey);
  }

  updateClock(_careerId: number, currentDate: number, tickIndex: number): void {
    this.clock = { ...this.clock, currentDate, tickIndex };
  }

  tryAppendEvent(event: SimEventDraft): boolean {
    if (this.eventKeys.has(event.eventKey)) return false;
    this.eventKeys.add(event.eventKey);
    this.events.push(event);
    return true;
  }

  applyMutation(mutation: Mutation): void {
    this.value += mutation.amount;
  }

  schedule(followUp: QueuedEvent): void {
    if (!this.queue.some((event) => event.eventKey === followUp.eventKey)) {
      this.queue.push(followUp);
    }
  }
}

function effect(eventKey: string, amount: number, pause = false): Effect<Mutation> {
  return {
    event: { eventKey, kind: 'test.changed', payload: { amount } },
    mutation: { amount },
    ...(pause ? { requiresUserDecision: true, decisionReason: 'Choose a response' } : {}),
  };
}

describe('effect application', () => {
  it('deduplicates by deterministic event key before mutation or follow-up scheduling', () => {
    const store = new MemoryStore();
    const first = effect('1|change|||0', 5);
    const result = applyEffects(store, [first, first]);

    expect(result).toEqual({ applied: 1, duplicates: 1 });
    expect(store.value).toBe(5);
    expect(store.events).toHaveLength(1);
  });

  it('builds stable, legible event keys', () => {
    expect(deterministicEventKey({
      tick: 12,
      kind: 'contract.expired',
      subjectId: 42,
      causeEventId: 7,
      ordinal: 2,
    })).toBe('12|contract.expired|42|7|2');
  });
});

describe('advance-time loop', () => {
  it('orders due events deterministically and advances 365 days reproducibly', () => {
    const run = () => {
      const store = new MemoryStore();
      store.queue.push(
        { eventKey: 'b', dueOn: 20_001, priority: 100, kind: 'add', subjectId: 2 },
        { eventKey: 'a', dueOn: 20_001, priority: 50, kind: 'add', subjectId: 1 },
      );
      const seen: string[] = [];
      const result = advanceTo(store, 1, 20_365, {
        handlers: {
          add: (context, event) => {
            seen.push(event.eventKey);
            return [effect(
              deterministicEventKey({
                tick: context.tick,
                kind: 'add',
                ...(event.subjectId === undefined ? {} : { subjectId: event.subjectId }),
              }),
              context.rng.for('amount', event.subjectId).int(1, 10),
            )];
          },
        },
      });
      return {
        result,
        seen,
        value: store.value,
        events: store.events,
        clock: store.clock,
        transactions: store.transactionCount,
      };
    };

    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.seen).toEqual(['a', 'b']);
    expect(first.result).toMatchObject({
      state: 'completed',
      daysAdvanced: 365,
      currentDate: 20_365,
      tickIndex: 365,
    });
    expect(first.transactions).toBe(365);
  });

  it('commits the day and tick before pausing for a user decision', () => {
    const store = new MemoryStore();
    store.queue.push({
      eventKey: 'decision',
      dueOn: 20_001,
      priority: 1,
      kind: 'decision',
    });
    const result = advanceTo(store, 1, 20_010, {
      handlers: {
        decision: (context) => [
          effect(deterministicEventKey({ tick: context.tick, kind: 'decision' }), 1, true),
        ],
      },
    });

    expect(result).toMatchObject({
      state: 'paused',
      currentDate: 20_001,
      tickIndex: 1,
      daysAdvanced: 1,
      reason: 'Choose a response',
    });
    expect(store.clock).toMatchObject({ currentDate: 20_001, tickIndex: 1 });
  });

  it('rolls back a whole day if any handler fails', () => {
    const store = new MemoryStore();
    store.queue.push({
      eventKey: 'explode',
      dueOn: 20_001,
      priority: 1,
      kind: 'explode',
    });
    expect(() => advanceTo(store, 1, 20_002, {
      handlers: {
        explode: () => { throw new Error('boom'); },
      },
    })).toThrow('boom');
    expect(store.clock).toMatchObject({ currentDate: 20_000, tickIndex: 0 });
    expect(store.queue).toHaveLength(1);
    expect(store.events).toHaveLength(0);
  });

  it('runs cadence passes on UTC calendar boundaries', () => {
    const store = new MemoryStore();
    // 2024-01-31, followed by 2024-02-01.
    store.clock = { ...store.clock, currentDate: 19_753 };
    let monthlyRuns = 0;
    const result = advanceTo(store, 1, 19_754, {
      handlers: {},
      monthlyPass: (context) => {
        monthlyRuns += 1;
        return [effect(
          deterministicEventKey({ tick: context.tick, kind: 'monthly' }),
          1,
        )];
      },
    });
    expect(result.state).toBe('completed');
    expect(monthlyRuns).toBe(1);
    expect(store.value).toBe(1);
  });
});
