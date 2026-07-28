export interface SimEventDraft {
  readonly eventKey: string;
  readonly kind: string;
  readonly subjectType?: string;
  readonly subjectId?: number;
  readonly causeEventId?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly rngStream?: string;
  readonly rngDraws?: readonly number[];
}

export interface FollowUpDraft {
  readonly eventKey: string;
  readonly dueOn: number;
  readonly priority: number;
  readonly kind: string;
  readonly subjectType?: string;
  readonly subjectId?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly causeEventId?: number;
}

export interface Effect<Mutation = unknown> {
  readonly event: SimEventDraft;
  readonly mutation: Mutation;
  readonly followUps?: readonly FollowUpDraft[];
  readonly requiresUserDecision?: boolean;
  readonly decisionReason?: string;
}

export interface EffectApplicationStore<Mutation = unknown> {
  /**
   * Appends the causal event and returns true. Returns false if eventKey was
   * already present. The database implementation uses INSERT ... ON CONFLICT
   * DO NOTHING, making this the replay guard.
   */
  tryAppendEvent(event: SimEventDraft): boolean;
  /** The only sanctioned state mutation path. */
  applyMutation(mutation: Mutation, event: SimEventDraft): void;
  schedule(followUp: FollowUpDraft): void;
}

export interface AppliedEffects {
  readonly applied: number;
  readonly duplicates: number;
  readonly pause?: {
    readonly eventKey: string;
    readonly reason: string;
  };
}

export function applyEffects<Mutation>(
  store: EffectApplicationStore<Mutation>,
  effects: readonly Effect<Mutation>[],
): AppliedEffects {
  let applied = 0;
  let duplicates = 0;
  let pause: AppliedEffects['pause'];

  for (const effect of effects) {
    if (effect.event.eventKey.length === 0) {
      throw new Error('every effect must carry a non-empty deterministic eventKey');
    }
    if (!store.tryAppendEvent(effect.event)) {
      duplicates += 1;
      continue;
    }
    store.applyMutation(effect.mutation, effect.event);
    for (const followUp of effect.followUps ?? []) store.schedule(followUp);
    applied += 1;
    if (effect.requiresUserDecision === true && pause === undefined) {
      pause = {
        eventKey: effect.event.eventKey,
        reason: effect.decisionReason ?? effect.event.kind,
      };
    }
  }

  return {
    applied,
    duplicates,
    ...(pause === undefined ? {} : { pause }),
  };
}

export function deterministicEventKey(input: {
  readonly tick: number;
  readonly kind: string;
  readonly subjectId?: number;
  readonly causeEventId?: number;
  readonly ordinal?: number;
}): string {
  if (!Number.isInteger(input.tick) || input.tick < 0) {
    throw new Error('event key tick must be a non-negative integer');
  }
  if (input.kind.length === 0 || input.kind.includes('|')) {
    throw new Error('event key kind must be non-empty and may not contain "|"');
  }
  return [
    String(input.tick),
    input.kind,
    input.subjectId === undefined ? '' : String(input.subjectId),
    input.causeEventId === undefined ? '' : String(input.causeEventId),
    input.ordinal === undefined ? '0' : String(input.ordinal),
  ].join('|');
}
