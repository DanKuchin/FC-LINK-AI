export interface PhaseZeroGate {
  readonly id: string;
  readonly name: string;
  readonly state: 'PASS' | 'CONCERN' | 'FAIL' | 'UNKNOWN';
  readonly detail: string;
}

export function gradePhaseZero(evidence: Readonly<Record<string, unknown>>): {
  readonly gates: readonly PhaseZeroGate[];
  readonly proceed: boolean;
};
