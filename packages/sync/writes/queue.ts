import type { Db } from '../../persistence/db.js';

export type OperationState =
  | 'pending'
  | 'sent'
  | 'applied'
  | 'durable'
  | 'failed'
  | 'abandoned';

export interface WriteInstruction {
  readonly id: number;
  readonly careerId: number;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, unknown>>;
  readonly state: OperationState;
  readonly attempts: number;
  readonly createdAt: number;
  readonly lastAttemptAt: number | null;
  readonly lastError: string | null;
  readonly observed: unknown;
}

export interface EnqueueInstruction {
  readonly careerId: number;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, unknown>>;
  readonly checkpointId?: number | null;
  readonly now: number;
}

interface OperationRow {
  readonly id: number;
  readonly career_id: number;
  readonly idempotency_key: string;
  readonly kind: string;
  readonly target_json: string;
  readonly params_json: string;
  readonly state: OperationState;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly created_at: number;
  readonly last_attempt_at: number | null;
  readonly observed_json: string | null;
}

export class WriteQueueError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'idempotency_conflict'
      | 'invalid_transition'
      | 'missing_operation'
      | 'invalid_ack',
  ) {
    super(message);
    this.name = 'WriteQueueError';
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function parseJson(value: string | null): unknown {
  return value === null ? null : JSON.parse(value) as unknown;
}

function instruction(row: OperationRow): WriteInstruction {
  return {
    id: row.id,
    careerId: row.career_id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    target: JSON.parse(row.target_json) as Record<string, unknown>,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    state: row.state,
    attempts: row.attempts,
    createdAt: row.created_at,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    observed: parseJson(row.observed_json),
  };
}

function rowByKey(db: Db, idempotencyKey: string): OperationRow | undefined {
  return db.get<OperationRow>(
    'SELECT * FROM sync_operations WHERE idempotency_key = ?',
    idempotencyKey,
  );
}

function requireRow(db: Db, idempotencyKey: string): OperationRow {
  const row = rowByKey(db, idempotencyKey);
  if (row === undefined) {
    throw new WriteQueueError(
      `write operation ${idempotencyKey} does not exist`,
      'missing_operation',
    );
  }
  return row;
}

export function enqueueInstruction(db: Db, input: EnqueueInstruction): WriteInstruction {
  if (input.idempotencyKey.length === 0 || input.kind.length === 0) {
    throw new Error('idempotencyKey and kind are required');
  }
  const targetJson = stableJson(input.target);
  const paramsJson = stableJson(input.params);
  return db.transaction(() => {
    const existing = rowByKey(db, input.idempotencyKey);
    if (existing !== undefined) {
      if (
        existing.career_id !== input.careerId ||
        existing.kind !== input.kind ||
        existing.target_json !== targetJson ||
        existing.params_json !== paramsJson
      ) {
        throw new WriteQueueError(
          `idempotency key ${input.idempotencyKey} was reused for different work`,
          'idempotency_conflict',
        );
      }
      return instruction(existing);
    }
    db.run(
      `INSERT INTO sync_operations (
        career_id, idempotency_key, kind, target_json, params_json, state,
        attempts, checkpoint_id, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      input.careerId,
      input.idempotencyKey,
      input.kind,
      targetJson,
      paramsJson,
      input.checkpointId ?? null,
      input.now,
    );
    return instruction(requireRow(db, input.idempotencyKey));
  });
}

export function collectInstructions(
  db: Db,
  input: {
    readonly careerId: number;
    readonly now: number;
    readonly limit?: number;
    readonly retryAfterMs?: number;
  },
): WriteInstruction[] {
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error('write batches must contain between 1 and 10 instructions');
  }
  const retryBefore = input.now - (input.retryAfterMs ?? 30_000);
  return db.transaction(() => {
    const rows = db.all<OperationRow>(
      `SELECT * FROM sync_operations
       WHERE career_id = ?
         AND (
           state = 'pending'
           OR (state = 'sent' AND COALESCE(last_attempt_at, 0) <= ?)
         )
       ORDER BY created_at, id
       LIMIT ?`,
      input.careerId,
      retryBefore,
      limit,
    );
    for (const row of rows) {
      const attempt = row.attempts + 1;
      db.run(
        `UPDATE sync_operations
         SET state = 'sent', attempts = ?, last_attempt_at = ?, last_error = NULL
         WHERE id = ?`,
        attempt,
        input.now,
        row.id,
      );
      db.run(
        `INSERT INTO sync_operation_attempts (
          operation_id, attempt_number, sent_at
        ) VALUES (?, ?, ?)`,
        row.id,
        attempt,
        input.now,
      );
    }
    return rows.map((row) => instruction(requireRow(db, row.idempotency_key)));
  });
}

export function acknowledgeInstruction(
  db: Db,
  input: {
    readonly idempotencyKey: string;
    readonly result: 'applied' | 'failed';
    readonly now: number;
    readonly observed?: unknown;
    readonly error?: string;
  },
): WriteInstruction {
  return db.transaction(() => {
    const row = requireRow(db, input.idempotencyKey);
    if (row.state === 'applied' && input.result === 'applied') return instruction(row);
    if (row.state !== 'sent') {
      throw new WriteQueueError(
        `cannot acknowledge ${input.idempotencyKey} from state ${row.state}`,
        'invalid_transition',
      );
    }
    if (input.result === 'failed' && (input.error === undefined || input.error.length === 0)) {
      throw new WriteQueueError('a failed acknowledgement requires an error', 'invalid_ack');
    }
    const observedJson = input.observed === undefined ? null : stableJson(input.observed);
    db.run(
      `UPDATE sync_operations
       SET state = ?, observed_json = ?, last_error = ?, resolved_at = ?
       WHERE id = ?`,
      input.result,
      observedJson,
      input.result === 'failed' ? input.error ?? 'unknown error' : null,
      input.result === 'failed' ? input.now : null,
      row.id,
    );
    db.run(
      `UPDATE sync_operation_attempts
       SET acknowledged_at = ?, result = ?, observed_json = ?, error = ?
       WHERE operation_id = ? AND attempt_number = ?`,
      input.now,
      input.result,
      observedJson,
      input.error ?? null,
      row.id,
      row.attempts,
    );
    return instruction(requireRow(db, input.idempotencyKey));
  });
}

export function markInstructionDurable(
  db: Db,
  idempotencyKey: string,
  now: number,
): WriteInstruction {
  return db.transaction(() => {
    const row = requireRow(db, idempotencyKey);
    if (row.state === 'durable') return instruction(row);
    if (row.state !== 'applied') {
      throw new WriteQueueError(
        `cannot mark ${idempotencyKey} durable from state ${row.state}`,
        'invalid_transition',
      );
    }
    db.run(
      `UPDATE sync_operations
       SET state = 'durable', durable_at = ?, resolved_at = ?
       WHERE id = ?`,
      now,
      now,
      row.id,
    );
    return instruction(requireRow(db, idempotencyKey));
  });
}

export function listInstructions(db: Db, careerId: number): WriteInstruction[] {
  return db.all<OperationRow>(
    'SELECT * FROM sync_operations WHERE career_id = ? ORDER BY created_at, id',
    careerId,
  ).map(instruction);
}
