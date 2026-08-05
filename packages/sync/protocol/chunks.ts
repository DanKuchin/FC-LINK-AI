import crypto from 'node:crypto';

export interface SnapshotChunk {
  readonly transfer_id: string;
  readonly seq: number;
  readonly of: number;
  readonly name: string;
  readonly payload: string;
  readonly checksum: string;
}

export interface PendingChunkResult {
  readonly state: 'pending';
  readonly duplicate: boolean;
  readonly have: number;
  readonly of: number;
}

export interface CommittedChunkResult {
  readonly state: 'committed';
  readonly duplicate: false;
  readonly name: string;
  readonly transfer_id: string;
  readonly payload: string;
  readonly bytes: number;
  readonly checksum: string;
}

export type ChunkResult = PendingChunkResult | CommittedChunkResult;

interface Transfer {
  readonly transferId: string;
  readonly name: string;
  readonly of: number;
  readonly checksum: string;
  readonly parts: Map<number, string>;
}

export class SnapshotChunkError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_chunk'
      | 'transfer_conflict'
      | 'checksum_mismatch'
      | 'too_many_transfers'
      | 'payload_too_large',
  ) {
    super(message);
    this.name = 'SnapshotChunkError';
  }
}

export interface SnapshotAssemblerOptions {
  readonly maxTransfers?: number;
  readonly maxTransferBytes?: number;
}

function validateChunk(chunk: SnapshotChunk): void {
  if (chunk.transfer_id.length === 0 || chunk.name.length === 0) {
    throw new SnapshotChunkError('transfer_id and name are required', 'invalid_chunk');
  }
  if (!Number.isInteger(chunk.seq) || !Number.isInteger(chunk.of) ||
      chunk.seq < 1 || chunk.of < 1 || chunk.seq > chunk.of) {
    throw new SnapshotChunkError('seq/of must be positive integers with seq <= of', 'invalid_chunk');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(chunk.checksum)) {
    throw new SnapshotChunkError('checksum must be a lowercase sha256 digest', 'invalid_chunk');
  }
}

export class SnapshotAssembler {
  private readonly transfers = new Map<string, Transfer>();
  private readonly maxTransfers: number;
  private readonly maxTransferBytes: number;

  constructor(options: SnapshotAssemblerOptions = {}) {
    this.maxTransfers = options.maxTransfers ?? 8;
    this.maxTransferBytes = options.maxTransferBytes ?? 128 * 1024 * 1024;
  }

  get inFlight(): number {
    return this.transfers.size;
  }

  discard(transferId: string): boolean {
    return this.transfers.delete(transferId);
  }

  add(chunk: SnapshotChunk): ChunkResult {
    validateChunk(chunk);
    let transfer = this.transfers.get(chunk.transfer_id);
    if (transfer === undefined) {
      if (this.transfers.size >= this.maxTransfers) {
        throw new SnapshotChunkError(
          `at most ${this.maxTransfers} snapshot transfers may be in flight`,
          'too_many_transfers',
        );
      }
      transfer = {
        transferId: chunk.transfer_id,
        name: chunk.name,
        of: chunk.of,
        checksum: chunk.checksum,
        parts: new Map(),
      };
      this.transfers.set(chunk.transfer_id, transfer);
    } else if (
      transfer.of !== chunk.of ||
      transfer.name !== chunk.name ||
      transfer.checksum !== chunk.checksum
    ) {
      throw new SnapshotChunkError(
        `chunk metadata conflicts with transfer ${chunk.transfer_id}`,
        'transfer_conflict',
      );
    }

    if (transfer.parts.has(chunk.seq)) {
      return {
        state: 'pending',
        duplicate: true,
        have: transfer.parts.size,
        of: transfer.of,
      };
    }
    transfer.parts.set(chunk.seq, chunk.payload);

    const bytes = [...transfer.parts.values()]
      .reduce((total, part) => total + Buffer.byteLength(part), 0);
    if (bytes > this.maxTransferBytes) {
      this.transfers.delete(chunk.transfer_id);
      throw new SnapshotChunkError(
        `snapshot exceeds ${this.maxTransferBytes} bytes`,
        'payload_too_large',
      );
    }

    if (transfer.parts.size < transfer.of) {
      return {
        state: 'pending',
        duplicate: false,
        have: transfer.parts.size,
        of: transfer.of,
      };
    }

    const payload = Array.from(
      { length: transfer.of },
      (_, index) => transfer.parts.get(index + 1) ?? '',
    ).join('');
    const actual = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    this.transfers.delete(chunk.transfer_id);
    if (actual !== transfer.checksum) {
      throw new SnapshotChunkError(
        `snapshot checksum mismatch: expected ${transfer.checksum}, received ${actual}`,
        'checksum_mismatch',
      );
    }
    return {
      state: 'committed',
      duplicate: false,
      name: transfer.name,
      transfer_id: transfer.transferId,
      payload,
      bytes: Buffer.byteLength(payload),
      checksum: actual,
    };
  }
}
