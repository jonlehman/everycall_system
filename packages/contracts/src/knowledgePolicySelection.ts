import type { CallState, KnowledgeGuardrail, KnowledgeOverride } from "./knowledgeReceptionist.js";

type JsonRecord = Record<string, unknown>;

type RuntimeBundleScopeLike = {
  active_domain_id?: string | null;
  active_subdomain_id?: string | null;
  runtime_mode?: string | null;
};

const ELIGIBILITY_STRONG_TOKEN_LEN = 5;
const ELIGIBILITY_TOKEN_MIN_LEN = 3;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function tokenizeSearchText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function buildTriggerEvidence(query: string, haystackTexts: string[]) {
  const queryText = normalizeText(query).toLowerCase();
  if (!queryText) {
    return {
      eligible: false,
      score: 0
    };
  }

  const queryTokens = tokenizeSearchText(queryText).filter((token) => token.length >= ELIGIBILITY_TOKEN_MIN_LEN);
  const haystack = uniqueValues(haystackTexts.map((item) => normalizeText(item))).join(" ").toLowerCase();
  const haystackTokens = new Set(tokenizeSearchText(haystack));

  const phraseMatch = haystack.includes(queryText);
  let tokenOverlapCount = 0;
  let strongTokenOverlapCount = 0;
  let score = phraseMatch ? 18 : 0;

  for (const token of queryTokens) {
    if (!token) continue;
    if (haystackTokens.has(token) || haystack.includes(token)) {
      tokenOverlapCount += 1;
      if (token.length >= ELIGIBILITY_STRONG_TOKEN_LEN) {
        strongTokenOverlapCount += 1;
        score += 6;
      } else {
        score += 3;
      }
    }
  }

  return {
    eligible: phraseMatch || strongTokenOverlapCount >= 1 || tokenOverlapCount >= 2,
    score
  };
}

function isWithinEffectiveWindow(item: Record<string, unknown>, at = new Date()) {
  const effectiveFrom = normalizeText(item.effective_from || item.effectiveFrom);
  const effectiveUntil = normalizeText(item.effective_until || item.effectiveUntil);
  const timestamp = at instanceof Date ? at.getTime() : Date.now();
  if (effectiveFrom) {
    const fromTime = Date.parse(effectiveFrom);
    if (Number.isFinite(fromTime) && timestamp < fromTime) return false;
  }
  if (effectiveUntil) {
    const untilTime = Date.parse(effectiveUntil);
    if (Number.isFinite(untilTime) && timestamp > untilTime) return false;
  }
  return true;
}

function scopeMatches(item: Record<string, unknown>, callState: CallState | null, runtimeBundle: RuntimeBundleScopeLike) {
  const domains = asStringArray(item.applies_to_domains);
  const subdomains = asStringArray(item.applies_to_subdomains);
  const scope = asObject(item.scope);
  const runtimeMode = normalizeText(runtimeBundle.runtime_mode);
  const stateDomainId = normalizeText(callState?.active_domain_id || runtimeBundle.active_domain_id);
  const stateSubdomainId = normalizeText(callState?.active_subdomain_id || runtimeBundle.active_subdomain_id);
  if (domains.length && !domains.includes(stateDomainId)) return false;
  if (subdomains.length && !subdomains.includes(stateSubdomainId)) return false;
  if (scope.runtime_mode && runtimeMode && normalizeText(scope.runtime_mode) !== runtimeMode) return false;
  return true;
}

function normalizeOverrideLike<TOverride extends KnowledgeOverride | Record<string, unknown>>(override: TOverride) {
  return {
    overrideType: normalizeText((override as Record<string, unknown>).override_type || (override as Record<string, unknown>).overrideType),
    priority: Number((override as Record<string, unknown>).priority || 100),
    title: normalizeText((override as Record<string, unknown>).title),
    body: normalizeText((override as Record<string, unknown>).body),
    appliesToIntents: asStringArray((override as Record<string, unknown>).applies_to_intents || (override as Record<string, unknown>).applies_to_intents_json || (override as Record<string, unknown>).appliesToIntents)
  };
}

function normalizeGuardrailLike<TGuardrail extends KnowledgeGuardrail | Record<string, unknown>>(guardrail: TGuardrail) {
  return {
    triggerPatterns: asStringArray((guardrail as Record<string, unknown>).trigger_patterns || (guardrail as Record<string, unknown>).trigger_patterns_json || (guardrail as Record<string, unknown>).triggerPatterns),
    triggerIntents: asStringArray((guardrail as Record<string, unknown>).trigger_intents || (guardrail as Record<string, unknown>).trigger_intents_json || (guardrail as Record<string, unknown>).triggerIntents),
    riskLevel: normalizeText((guardrail as Record<string, unknown>).risk_level || (guardrail as Record<string, unknown>).riskLevel)
  };
}

export function selectMatchedOverrides<TOverride extends KnowledgeOverride | Record<string, unknown>>(
  overrides: TOverride[],
  query: string,
  runtimeBundle: RuntimeBundleScopeLike
) {
  return (Array.isArray(overrides) ? overrides : [])
    .map((item) => {
      const normalized = normalizeOverrideLike(item);
      if (!isWithinEffectiveWindow(item as Record<string, unknown>)) return { item, score: -1 };
      if (!scopeMatches(item as Record<string, unknown>, null, runtimeBundle)) return { item, score: -1 };
      const trigger = buildTriggerEvidence(query, [
        normalized.title,
        normalized.body,
        ...normalized.appliesToIntents
      ]);
      if (!trigger.eligible) return { item, score: -1 };

      let score = trigger.score;
      if (normalized.overrideType === "hard_fact") score += 12;
      if (normalized.overrideType === "temporary_notice") score += 10;
      if (normalized.overrideType === "approved_answer") score += 8;
      score += Math.max(0, 20 - normalized.priority / 10);
      return { item, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((item) => item.item);
}

export function selectMatchedGuardrails<TGuardrail extends KnowledgeGuardrail | Record<string, unknown>>(
  guardrails: TGuardrail[],
  query: string,
  runtimeBundle: RuntimeBundleScopeLike,
  callState: CallState | null
) {
  return (Array.isArray(guardrails) ? guardrails : [])
    .map((item) => {
      const normalized = normalizeGuardrailLike(item);
      if (!scopeMatches(item as Record<string, unknown>, callState, runtimeBundle)) return { item, score: -1 };
      const patternEvidence = normalized.triggerPatterns.map((pattern) => buildTriggerEvidence(query, [pattern]));
      const intentEvidence = normalized.triggerIntents.map((intent) => buildTriggerEvidence(query, [intent]));
      const eligibleEvidence = [...patternEvidence, ...intentEvidence].filter((entry) => entry.eligible);
      if (!eligibleEvidence.length) return { item, score: -1 };

      let score = eligibleEvidence.reduce((sum, current) => sum + current.score, 0);
      if (normalized.riskLevel === "critical") score += 24;
      else if (normalized.riskLevel === "high") score += 18;
      else if (normalized.riskLevel === "medium") score += 12;
      else score += 6;
      return { item, score };
    })
    .filter((entry) => {
      const row = entry.item as Record<string, unknown>;
      return entry.score > 0
        && normalizeText(row.status) === "approved_live"
        && row.enabled !== false;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((item) => item.item);
}
