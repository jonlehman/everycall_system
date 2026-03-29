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

export function estimateAiCostMicrosUsd(usage: AiUsageCostInput, rates: AiUsageRateCard) {
  const cachedInputTokens = toNonNegativeInt(usage.cachedInputTokens);
  const inputTextTokens = toNonNegativeInt(usage.inputTextTokens);
  const inputAudioTokens = toNonNegativeInt(usage.inputAudioTokens);
  const outputTextTokens = toNonNegativeInt(usage.outputTextTokens);
  const outputAudioTokens = toNonNegativeInt(usage.outputAudioTokens);
  const hasDetailedBreakdown = cachedInputTokens > 0
    || inputTextTokens > 0
    || inputAudioTokens > 0
    || outputTextTokens > 0
    || outputAudioTokens > 0;

  if (hasDetailedBreakdown) {
    return estimateTokenCostMicros(inputTextTokens, rates.textInputRatePer1MUsd)
      + estimateTokenCostMicros(cachedInputTokens, rates.cachedInputRatePer1MUsd)
      + estimateTokenCostMicros(inputAudioTokens, rates.audioInputRatePer1MUsd)
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
