import { streams, type Rng } from '../rng/index.js';
import {
  applyEffects,
  type Effect,
  type EffectApplicationStore,
} from './effects.js';

const DAY_MS = 86_400_000;

export interface CareerClock {
  readonly careerId: number;
  readonly currentDate: number;
  readonly tickIndex: number;
  readonly masterSeed: string;
}

export interface QueuedEvent {
  readonly eventKey: string;
  readonly dueOn: number;
  readonly priority: number;
  readonly kind: string;
  readonly subjectType?: string;
  readonly subjectId?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly causeEventId?: number;
}

export interface SimContext {
  readonly career: CareerClock;
  readonly day: number;
  readonly tick: number;
  readonly rng: {
    for(stream: string, entityId?: number | string): Rng;
  };
}

export type EventHandler<Mutation> = (
  context: SimContext,
  event: QueuedEvent,
) => readonly Effect<Mutation>[];

export type CadencePass<Mutation> = (context: SimContext) => readonly Effect<Mutation>[];

export interface AdvanceStore<Mutation> extends EffectApplicationStore<Mutation> {
  transaction<T>(operation: () => T): T;
  readCareer(careerId: number): CareerClock;
  dueEvents(careerId: number, day: number): readonly QueuedEvent[];
  hasEvent(eventKey: string): boolean;
  consumeQueuedEvent(careerId: number, eventKey: string): void;
  updateClock(careerId: number, currentDate: number, tickIndex: number): void;
}

export interface AdvanceOptions<Mutation> {
  readonly handlers: Readonly<Record<string, EventHandler<Mutation>>>;
  readonly weeklyPass?: CadencePass<Mutation>;
  readonly monthlyPass?: CadencePass<Mutation>;
  readonly windowPass?: CadencePass<Mutation>;
  readonly isWindowBoundary?: (day: number) => boolean;
  readonly seasonPass?: CadencePass<Mutation>;
  readonly isSeasonEnd?: (day: number) => boolean;
}

export interface AdvanceCompleted {
  readonly state: 'completed';
  readonly careerId: number;
  readonly currentDate: number;
  readonly tickIndex: number;
  readonly daysAdvanced: number;
  readonly effectsApplied: number;
  readonly duplicatesSkipped: number;
}

export interface AdvancePaused {
  readonly state: 'paused';
  readonly careerId: number;
  readonly currentDate: number;
  readonly tickIndex: number;
  readonly daysAdvanced: number;
  readonly effectsApplied: number;
  readonly duplicatesSkipped: number;
  readonly eventKey: string;
  readonly reason: string;
}

export type AdvanceResult = AdvanceCompleted | AdvancePaused;

function utcDate(day: number): Date {
  return new Date(day * DAY_MS);
}

export function isMonday(day: number): boolean {
  return utcDate(day).getUTCDay() === 1;
}

export function isFirstOfMonth(day: number): boolean {
  return utcDate(day).getUTCDate() === 1;
}

function ordered(events: readonly QueuedEvent[]): QueuedEvent[] {
  return [...events].sort((left, right) =>
    left.priority - right.priority ||
    left.kind.localeCompare(right.kind) ||
    (left.subjectId ?? -1) - (right.subjectId ?? -1) ||
    left.eventKey.localeCompare(right.eventKey));
}

export function advanceTo<Mutation>(
  store: AdvanceStore<Mutation>,
  careerId: number,
  targetDate: number,
  options: AdvanceOptions<Mutation>,
): AdvanceResult {
  let career = store.readCareer(careerId);
  if (!Number.isInteger(targetDate) || targetDate <= career.currentDate) {
    throw new Error('targetDate must be an integer after the career currentDate');
  }
  let daysAdvanced = 0;
  let effectsApplied = 0;
  let duplicatesSkipped = 0;

  while (career.currentDate < targetDate) {
    const result = store.transaction(() => {
      const fresh = store.readCareer(careerId);
      const tick = fresh.tickIndex + 1;
      const day = fresh.currentDate + 1;
      const context: SimContext = {
        career: fresh,
        day,
        tick,
        rng: streams(fresh.masterSeed, tick),
      };
      const effects: Effect<Mutation>[] = [];
      for (const event of ordered(store.dueEvents(careerId, day))) {
        if (store.hasEvent(event.eventKey)) {
          store.consumeQueuedEvent(careerId, event.eventKey);
          continue;
        }
        const handler = options.handlers[event.kind];
        if (handler === undefined) {
          throw new Error(`no simulation handler registered for ${event.kind}`);
        }
        effects.push(...handler(context, event));
        store.consumeQueuedEvent(careerId, event.eventKey);
      }
      if (isMonday(day)) effects.push(...(options.weeklyPass?.(context) ?? []));
      if (isFirstOfMonth(day)) effects.push(...(options.monthlyPass?.(context) ?? []));
      if (options.isWindowBoundary?.(day) === true) {
        effects.push(...(options.windowPass?.(context) ?? []));
      }
      if (options.isSeasonEnd?.(day) === true) {
        effects.push(...(options.seasonPass?.(context) ?? []));
      }

      const applied = applyEffects(store, effects);
      store.updateClock(careerId, day, tick);
      return { day, tick, applied };
    });
    daysAdvanced += 1;
    effectsApplied += result.applied.applied;
    duplicatesSkipped += result.applied.duplicates;
    career = store.readCareer(careerId);
    if (result.applied.pause !== undefined) {
      return {
        state: 'paused',
        careerId,
        currentDate: result.day,
        tickIndex: result.tick,
        daysAdvanced,
        effectsApplied,
        duplicatesSkipped,
        eventKey: result.applied.pause.eventKey,
        reason: result.applied.pause.reason,
      };
    }
  }

  return {
    state: 'completed',
    careerId,
    currentDate: career.currentDate,
    tickIndex: career.tickIndex,
    daysAdvanced,
    effectsApplied,
    duplicatesSkipped,
  };
}
