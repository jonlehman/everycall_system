import crypto from "node:crypto";

export type DataCaptureValidation = {
  status: string;
  errors: string[];
};

export type DataCaptureControlState = {
  completedByFingerprint: Map<string, DataCaptureValidation>;
  continuationTurnSequence: number | null;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function createDataCaptureControlState(): DataCaptureControlState {
  return {
    completedByFingerprint: new Map<string, DataCaptureValidation>(),
    continuationTurnSequence: null
  };
}

export function fingerprintDataCaptureArgs(args: Record<string, unknown>) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(args)))
    .digest("hex");
}

export function getCompletedDataCapture(
  state: DataCaptureControlState,
  fingerprint: string
) {
  return state.completedByFingerprint.get(fingerprint) || null;
}

export function recordCompletedDataCapture(
  state: DataCaptureControlState,
  fingerprint: string,
  validation: DataCaptureValidation
) {
  state.completedByFingerprint.set(fingerprint, {
    status: String(validation.status || ""),
    errors: Array.isArray(validation.errors) ? [...validation.errors] : []
  });
}

export function claimDataCaptureContinuation(
  state: DataCaptureControlState,
  callerTurnSequence: number
) {
  if (state.continuationTurnSequence === callerTurnSequence) {
    return false;
  }
  state.continuationTurnSequence = callerTurnSequence;
  return true;
}
