function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeInt(value: unknown) {
  const parsed = Math.round(toFiniteNumber(value, 0));
  return parsed > 0 ? parsed : 0;
}

export type AiUsageCostInput = {
  inputTokens?: number | null | undefined;
  outputTokens?: number | null | undefined;
  cachedInputTokens?: number | null | undefined;
  cachedInputTextTokens?: number | null | undefined;
  cachedInputAudioTokens?: number | null | undefined;
  inputTextTokens?: number | null | undefined;
  inputAudioTokens?: number | null | undefined;
  outputTextTokens?: number | null | undefined;
  outputAudioTokens?: number | null | undefined;
};

export type AiUsageRateCard = {
  textInputRatePer1MUsd: number;
  cachedInputRatePer1MUsd: number;
  audioInputRatePer1MUsd: number;
  textOutputRatePer1MUsd: number;
  audioOutputRatePer1MUsd: number;
};

export type NotificationCostInput = {
  smsAccepted?: number | null;
  emailAccepted?: number | null;
};

export function usdToMicros(usd: number) {
  return Math.round(toFiniteNumber(usd, 0) * 1_000_000);
}

export function microsToUsd(micros: number) {
  return toFiniteNumber(micros, 0) / 1_000_000;
}

export function estimateBillableMinutes(durationSeconds: number, billingIncrementSeconds = 60) {
  const seconds = Math.max(0, toFiniteNumber(durationSeconds, 0));
  const increment = Math.max(1, toFiniteNumber(billingIncrementSeconds, 60));
  return seconds > 0 ? Math.ceil(seconds / increment) : 0;
}

function estimateTokenCostMicros(tokens: number, ratePer1MUsd: number) {
  return Math.round((toNonNegativeInt(tokens) * usdToMicros(ratePer1MUsd)) / 1_000_000);
}

function allocateCachedTokens(totalTokens: number, cachedTokens: number, primaryTokens: number, secondaryTokens: number) {
  const boundedCached = Math.min(toNonNegativeInt(cachedTokens), Math.max(0, totalTokens));
  const primary = Math.max(0, toNonNegativeInt(primaryTokens));
  const secondary = Math.max(0, toNonNegativeInt(secondaryTokens));
  const total = primary + secondary;
  if (boundedCached <= 0 || total <= 0) {
    return { cachedPrimary: 0, cachedSecondary: 0 };
  }
  let cachedPrimary = Math.min(primary, Math.round((boundedCached * primary) / total));
  let cachedSecondary = Math.min(secondary, boundedCached - cachedPrimary);
  let remaining = boundedCached - cachedPrimary - cachedSecondary;
  if (remaining > 0) {
    const primaryCapacity = Math.max(0, primary - cachedPrimary);
    const secondaryCapacity = Math.max(0, secondary - cachedSecondary);
    const primaryExtra = Math.min(primaryCapacity, remaining);
    cachedPrimary += primaryExtra;
    remaining -= primaryExtra;
    if (remaining > 0) {
      const secondaryExtra = Math.min(secondaryCapacity, remaining);
      cachedSecondary += secondaryExtra;
    }
  }
  return { cachedPrimary, cachedSecondary };
}

export function estimateAiCostMicrosUsd(usage: AiUsageCostInput, rates: AiUsageRateCard) {
  const cachedInputTokens = toNonNegativeInt(usage.cachedInputTokens);
  const cachedInputTextTokens = toNonNegativeInt(usage.cachedInputTextTokens);
  const cachedInputAudioTokens = toNonNegativeInt(usage.cachedInputAudioTokens);
  const inputTextTokens = toNonNegativeInt(usage.inputTextTokens);
  const inputAudioTokens = toNonNegativeInt(usage.inputAudioTokens);
  const outputTextTokens = toNonNegativeInt(usage.outputTextTokens);
  const outputAudioTokens = toNonNegativeInt(usage.outputAudioTokens);
  const hasDetailedBreakdown = cachedInputTokens > 0
    || cachedInputTextTokens > 0
    || cachedInputAudioTokens > 0
    || inputTextTokens > 0
    || inputAudioTokens > 0
    || outputTextTokens > 0
    || outputAudioTokens > 0;

  if (hasDetailedBreakdown) {
    let cachedText = Math.min(inputTextTokens, cachedInputTextTokens);
    let cachedAudio = Math.min(inputAudioTokens, cachedInputAudioTokens);
    const explicitCachedTotal = cachedText + cachedAudio;
    const unresolvedCached = Math.max(0, cachedInputTokens - explicitCachedTotal);
    if (unresolvedCached > 0) {
      const allocation = allocateCachedTokens(
        inputTextTokens + inputAudioTokens - explicitCachedTotal,
        unresolvedCached,
        inputTextTokens - cachedText,
        inputAudioTokens - cachedAudio
      );
      cachedText += allocation.cachedPrimary;
      cachedAudio += allocation.cachedSecondary;
    }
    const uncachedText = Math.max(0, inputTextTokens - cachedText);
    const uncachedAudio = Math.max(0, inputAudioTokens - cachedAudio);
    return estimateTokenCostMicros(uncachedText, rates.textInputRatePer1MUsd)
      + estimateTokenCostMicros(cachedText + cachedAudio, rates.cachedInputRatePer1MUsd)
      + estimateTokenCostMicros(uncachedAudio, rates.audioInputRatePer1MUsd)
      + estimateTokenCostMicros(outputTextTokens, rates.textOutputRatePer1MUsd)
      + estimateTokenCostMicros(outputAudioTokens, rates.audioOutputRatePer1MUsd);
  }

  return estimateTokenCostMicros(usage.inputTokens || 0, rates.textInputRatePer1MUsd)
    + estimateTokenCostMicros(usage.outputTokens || 0, rates.textOutputRatePer1MUsd);
}

export function estimateTelephonyCostMicrosUsd(durationSeconds: number, ratePerMinuteUsd: number, billingIncrementSeconds = 60) {
  const billableMinutes = estimateBillableMinutes(durationSeconds, billingIncrementSeconds);
  return Math.round(billableMinutes * usdToMicros(ratePerMinuteUsd));
}

export function estimateNotificationCostMicrosUsd(input: NotificationCostInput, { smsCostUsd = 0, emailCostUsd = 0 } = {}) {
  const smsAccepted = toNonNegativeInt(input.smsAccepted);
  const emailAccepted = toNonNegativeInt(input.emailAccepted);
  return Math.round(smsAccepted * usdToMicros(smsCostUsd))
    + Math.round(emailAccepted * usdToMicros(emailCostUsd));
}

export function sumOperationalCostMicrosUsd(...parts: Array<number | null | undefined>) {
  return parts.reduce<number>((sum, part) => sum + Math.max(0, Math.round(toFiniteNumber(part, 0))), 0);
}

export function estimatePeriodNumberCostCents(monthlyCostCents: number | null | undefined, purchasedAt: string | Date | null | undefined, {
  periodStartMs,
  periodEndMs
}: {
  periodStartMs: number;
  periodEndMs: number;
}) {
  const monthly = Math.max(0, Math.round(toFiniteNumber(monthlyCostCents, 0)));
  if (!monthly) return 0;

  const startMs = Number.isFinite(periodStartMs) ? periodStartMs : Date.now() - (30 * 24 * 60 * 60 * 1000);
  const endMs = Number.isFinite(periodEndMs) ? periodEndMs : Date.now();
  if (endMs <= startMs) return 0;

  const purchasedMs = purchasedAt ? new Date(purchasedAt).getTime() : NaN;
  const effectiveStartMs = Number.isFinite(purchasedMs) ? Math.max(startMs, purchasedMs) : startMs;
  const activeMs = Math.max(0, endMs - effectiveStartMs);
  const ratio = Math.min(1, activeMs / (30 * 24 * 60 * 60 * 1000));
  return Math.round(monthly * ratio);
}
