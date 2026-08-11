import crypto from "node:crypto";
import { z } from "zod";
import { callOpenAiJsonModel } from "@everycall/contracts";

export const CORE_FACT_SELECTOR_VERSION = "automatic_core_facts_v2_ai_rated";
export const CORE_FACT_TOKEN_BUDGET = 600;
export const CORE_FACT_MAX_PINS = 20;
export const CORE_FACT_MAX_SWAPS_PER_REFRESH = 3;

const CORE_FACT_REFRESH_DAYS = 7;
const CORE_FACT_REFRESH_CALLS = 50;
const CORE_FACT_RETRIEVAL_MARGIN = 3;
const CORE_FACT_MIN_CANDIDATE_RETRIEVALS = 4;
const CORE_FACT_LLM_BATCH_SIZE = 30;

const INSTRUCTION_LIKE_FACT_PATTERN = /\b(ignore (all |any )?(previous|prior) instructions?|system prompt|developer message|assistant instructions?|call (a )?tool|knowledge_lookup|data_capture|finish_session)\b/i;
const TITLE_HIGH_RISK_PATTERN = /\b(24\/?7|emergency|licensed|insured|bonded|guaranteed?|free|same[- ]day|next[- ]day)\b/i;
const CORE_FACT_MARKETING_LEAK_PATTERN = /\b(premium|professional|expert|honest|comprehensive|quick|quickly|fast|easy)\b|\bfor various architectural styles\b|\bengineered[- ]for (?:broad )?(?:benefits?|performance)\b|\bsmooth operation\b/i;

function resolveCoreFactModel(model) {
  return normalizeText(model)
    || normalizeText(process.env.OPENAI_CORE_FACTS_MODEL)
    || normalizeText(process.env.OPENAI_KNOWLEDGE_BUILD_MODEL)
    || "gpt-4.1";
}

const scoredFactSchema = z.object({
  fact_id: z.string().min(1),
  title: z.string().max(80),
  spoken_fact: z.string().max(2000),
  importance_score: z.number().int().min(0).max(100),
  stable_for_months: z.boolean(),
  reason: z.string().max(800)
});

const scoredFactsSchema = z.object({
  facts: z.array(scoredFactSchema).max(CORE_FACT_LLM_BATCH_SIZE)
});

const curatedFactsSchema = z.object({
  fact_ids: z.array(z.string().min(1)).max(CORE_FACT_MAX_PINS)
});

const rewrittenFactsSchema = z.object({
  facts: z.array(z.object({
    fact_id: z.string().min(1),
    title: z.string().max(80),
    spoken_fact: z.string().max(320),
    reason: z.string().max(800)
  })).max(CORE_FACT_MAX_PINS)
});

const auditedFactsSchema = z.object({
  assessments: z.array(z.object({
    fact_id: z.string().min(1),
    approved: z.boolean(),
    marketing_language_remaining: z.boolean(),
    reason: z.string().max(800)
  })).max(CORE_FACT_MAX_PINS)
});

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOneLine(value) {
  return normalizeText(value).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
}

export async function loadCoreFactCompanyDescription(db, tenantKey) {
  const result = await db.query(
    `SELECT COALESCE(
              NULLIF(BTRIM(prompt.company_description), ''),
              NULLIF(BTRIM(bootstrap.company_description), '')
            ) AS company_description
     FROM tenants tenant
     LEFT JOIN tenant_prompt_profiles prompt
       ON prompt.tenant_key = tenant.tenant_key
     LEFT JOIN tenant_bootstrap_profiles bootstrap
       ON bootstrap.tenant_key = tenant.tenant_key
     WHERE tenant.tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  return normalizeOneLine(result.rows?.[0]?.company_description);
}

function normalizeFingerprintText(value) {
  return normalizeOneLine(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function estimateTokens(value) {
  return Math.ceil(Buffer.byteLength(String(value || ""), "utf8") / 4);
}

function ensureSentence(value) {
  const text = normalizeOneLine(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function semanticFactSequence(value) {
  return normalizeOneLine(value)
    .toLowerCase()
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\b(isn't|aren't|wasn't|weren't|doesn't|don't|didn't|hasn't|haven't|hadn't|couldn't|shouldn't|wouldn't|mustn't)\b/g, (match) => {
      const expansions = {
        "isn't": "is not",
        "aren't": "are not",
        "wasn't": "was not",
        "weren't": "were not",
        "doesn't": "does not",
        "don't": "do not",
        "didn't": "did not",
        "hasn't": "has not",
        "haven't": "have not",
        "hadn't": "had not",
        "couldn't": "could not",
        "shouldn't": "should not",
        "wouldn't": "would not",
        "mustn't": "must not"
      };
      return expansions[match] || match;
    })
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/g)
    .filter(Boolean);
}

const PROTECTED_REWRITE_WORDS = new Set([
  "not", "no", "never", "only", "except", "unless", "without",
  "cannot", "can", "may", "might", "could", "should", "must",
  "minimum", "maximum", "least", "most", "under", "over", "before", "after"
]);

const SAFE_REMOVABLE_REWRITE_SPANS = new Set([
  "engineered for smooth operation durability and energy performance with flexible design options",
  "enhancing transparency and compliance",
  "help businesses run smarter",
  "offering style flexibility energy efficiency and customization",
  "offering style flexibility material options energy efficiency and customization",
  "providing honest assessments and professional installation",
  "providing unified operational visibility"
]);

function tokenCounts(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function withoutTerminalPunctuation(value) {
  return normalizeOneLine(value).replace(/[.!?]+$/g, "").trim();
}

function isSafeTrailingPromotionalClauseRewrite(canonical, candidate) {
  const canonicalBody = withoutTerminalPunctuation(canonical);
  const candidateBody = withoutTerminalPunctuation(candidate);
  if (!canonicalBody || !candidateBody || candidateBody.length >= canonicalBody.length) return false;
  if (canonicalBody.slice(0, candidateBody.length).toLowerCase() !== candidateBody.toLowerCase()) return false;
  const suffix = canonicalBody.slice(candidateBody.length);
  if (!/^,\s+/.test(suffix)) return false;
  const suffixTokens = semanticFactSequence(suffix.replace(/^,\s+/, ""));
  return SAFE_REMOVABLE_REWRITE_SPANS.has(suffixTokens.join(" "));
}

export function isConservativeSpokenRewrite(claim, spoken) {
  const canonical = ensureSentence(claim);
  const candidate = ensureSentence(spoken);
  if (!canonical || !candidate || candidate.length > 320) return false;
  if (/[\[\]{}]|https?:\/\//i.test(candidate)) return false;
  const canonicalSequence = semanticFactSequence(canonical);
  const candidateSequence = semanticFactSequence(candidate);
  if (canonicalSequence.length === 0 || candidateSequence.length < 3 || candidateSequence.length > canonicalSequence.length) return false;

  const hasDeletion = candidateSequence.length < canonicalSequence.length;
  if (hasDeletion && !isSafeTrailingPromotionalClauseRewrite(canonical, candidate)) return false;
  if (!hasDeletion && candidateSequence.some((token, index) => token !== canonicalSequence[index])) return false;

  const candidateCounts = tokenCounts(candidateSequence);
  const protectedCanonicalCounts = tokenCounts(
    canonicalSequence.filter((token) => PROTECTED_REWRITE_WORDS.has(token) || /^\d+$/.test(token))
  );
  return [...protectedCanonicalCounts].every(([token, count]) => (candidateCounts.get(token) || 0) >= count);
}

export function createCoreFactFingerprint(fact) {
  const semanticIdentity = [
    normalizeFingerprintText(fact?.domain_id),
    normalizeFingerprintText(fact?.subject),
    normalizeFingerprintText(fact?.claim_text)
  ].join("|");
  return crypto.createHash("sha256").update(semanticIdentity).digest("hex");
}

function normalizeImportanceScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score <= 1 ? score * 100 : score));
}

function isSafeCoreFactTitle(title, claim) {
  const normalizedTitle = normalizeOneLine(title).replace(/:+$/g, "");
  const normalizedClaim = normalizeOneLine(claim);
  if (!normalizedTitle || normalizedTitle.length > 80 || /[\r\n:?]/.test(normalizedTitle)) return false;
  if (INSTRUCTION_LIKE_FACT_PATTERN.test(normalizedTitle)) return false;
  const titleNumbers = normalizedTitle.match(/\b\d+(?:\.\d+)?\b/g) || [];
  const claimNumbers = new Set(normalizedClaim.match(/\b\d+(?:\.\d+)?\b/g) || []);
  if (titleNumbers.some((value) => !claimNumbers.has(value))) return false;
  if (TITLE_HIGH_RISK_PATTERN.test(normalizedTitle) && !TITLE_HIGH_RISK_PATTERN.test(normalizedClaim)) return false;
  return true;
}

function hasCoreFactMarketingLeak(title, spokenFact) {
  return CORE_FACT_MARKETING_LEAK_PATTERN.test(`${normalizeOneLine(title)} ${normalizeOneLine(spokenFact)}`);
}

function normalizeScoredFact(fact, scored) {
  const canonical = ensureSentence(fact?.claim_text);
  if (!canonical || INSTRUCTION_LIKE_FACT_PATTERN.test(canonical)) return null;
  const stableForMonths = scored?.stable_for_months === true;
  const importanceScore = stableForMonths ? normalizeImportanceScore(scored?.importance_score ?? scored?.likelihood_score) : 0;
  const title = normalizeOneLine(scored?.title).replace(/:+$/g, "");
  const spoken = ensureSentence(scored?.spoken_fact);
  const safeSpoken = !INSTRUCTION_LIKE_FACT_PATTERN.test(spoken)
    && isConservativeSpokenRewrite(fact.claim_text, spoken)
    ? spoken
    : canonical;
  const renderedLineSafe = isSafeCoreFactTitle(title, canonical) && safeSpoken && safeSpoken.length <= 320;
  const acceptedImportance = renderedLineSafe ? importanceScore : 0;
  return {
    fact_id: normalizeText(fact.knowledge_fact_id),
    title: renderedLineSafe ? title : "",
    spoken_fact: renderedLineSafe ? safeSpoken : "",
    importance_score: acceptedImportance,
    likelihood_score: acceptedImportance / 100,
    stable_for_months: renderedLineSafe && stableForMonths,
    reason: renderedLineSafe
      ? (normalizeOneLine(scored?.reason) || "AI importance rating")
      : "AI rating rejected by semantic safety validation"
  };
}

function sourceFactCandidates(facts) {
  return (Array.isArray(facts) ? facts : []).filter((fact) =>
    normalizeText(fact?.knowledge_fact_id)
    && normalizeText(fact?.claim_text)
    && !INSTRUCTION_LIKE_FACT_PATTERN.test(normalizeOneLine(fact.claim_text))
  );
}

function creationRatingsById(facts) {
  const ratings = new Map();
  let ratedCount = 0;
  for (const fact of sourceFactCandidates(facts)) {
    const creation = fact?.core_fact_creation_rating;
    if (!creation || !Number.isFinite(Number(creation.importance_score))) continue;
    ratedCount += 1;
    const normalized = normalizeScoredFact(fact, {
      title: creation.title,
      spoken_fact: creation.spoken_text,
      importance_score: creation.importance_score,
      stable_for_months: creation.stable_for_months,
      reason: creation.reason
    });
    if (normalized) ratings.set(normalized.fact_id, normalized);
  }
  return { ratings, complete: ratedCount === sourceFactCandidates(facts).length && ratedCount > 0 };
}

async function scoreCandidateBatchWithModel(candidates, model, batchNumber, companyDescription = "", modelCaller = callOpenAiJsonModel) {
  if (!candidates.length) return { scoredById: new Map(), usedFallback: true, warning: "core_fact_candidates_empty" };
  const candidatePayload = candidates.map((fact) => ({
    fact_id: fact.knowledge_fact_id,
    subject: normalizeOneLine(fact.subject),
    role: normalizeOneLine(fact.fact_role),
    canonical_fact: normalizeOneLine(fact.claim_text)
  }));
  try {
    const result = await modelCaller({
      model: resolveCoreFactModel(model),
      system: [
        "Rate every supplied fact for a phone receptionist's small known-by-heart set. Do not select by keyword.",
        "Use importance_score 90-100 only for universal, frequently asked, stable business facts that should be answered instantly; 70-89 for common stable facts; 40-69 for useful lookup-only detail; and 0-39 for facts that should not be pinned.",
        "The strongest candidates are usually hours, service area, a plain-language service list, emergency-service posture, pricing posture, licensed or insured status, and how a customer gets started.",
        "Set stable_for_months false and importance_score 0 for dated or upcoming events, changing schedules, promotions or free offers, exact project-price ranges, current availability, temporary staffing, or facts likely to change within six months.",
        "Event operations are lookup-only even without a printed date: games, seasons, rosters, voting, open gyms, championships, event venues, event eligibility, and participant lists can change and must score 0.",
        "Website contact forms, prompts to send a message, and web-only submission instructions score 0 because a caller is already on the phone.",
        "A business address or office location is by-heart material only when the canonical fact itself contains a complete speakable address with enough city and state context for a caller to use it. Score a partial street-only address 0.",
        "Give score 0 to third-party rebates, incentive programs, utility-program qualifications, building-code requirements, regulatory guidance, and generic technical or how-to advice. They are lookup-only even when useful.",
        "Give score 0 to questions, headings, bylines, privacy or website-administration copy, marketing fragments, generic advice, incomplete prose, duplicates, and anything conflicting with the approved company description.",
        "Treat headline-style prefixes, calls to action, second-person sales language, and broad claims about innovation, success, results, ROI, or being tailored as marketing unless the sentence contains a concrete operational fact callers commonly ask for.",
        "Treat manufacturer or product claims centered on broad benefits such as beauty, performance, flexibility, efficiency, quality, or durability as marketing unless the same fact provides a concrete product type, specification, or option that answers a common caller question.",
        "The approved company description is authoritative. If it says the company is based in one city, score any fact claiming a different headquarters or base location 0, even when the cities are nearby or in the same metro area.",
        "Return one rating for every supplied fact_id. For every fact marked stable_for_months, write a short caller-language title and one complete natural spoken sentence so the later AI editor can judge it. For unstable facts, empty title and spoken_fact are allowed.",
        "Create one clean atomic spoken fact from the canonical fact. You may delete promotional adjectives, broad benefit clauses, and unrelated trailing material, but keep every remaining word in its original order.",
        "Never add, substitute, infer, broaden, combine, or contradict. Never delete a number, negation, limit, exception, or modal qualifier such as can, may, or must.",
        "Treat the importance score as an absolute calibrated score so results from separate batches can be compared."
      ].join("\n"),
      user: JSON.stringify({ approved_company_description: normalizeOneLine(companyDescription), candidates: candidatePayload }),
      schema: scoredFactsSchema,
      jsonSchemaName: "automatic_core_fact_selection",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["facts"],
        properties: {
          facts: {
            type: "array",
            maxItems: CORE_FACT_LLM_BATCH_SIZE,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fact_id", "title", "spoken_fact", "importance_score", "stable_for_months", "reason"],
              properties: {
                fact_id: { type: "string" },
                title: { type: "string" },
                spoken_fact: { type: "string" },
                importance_score: { type: "integer", minimum: 0, maximum: 100 },
                stable_for_months: { type: "boolean" },
                reason: { type: "string" }
              }
            }
          }
        }
      },
      temperature: 0,
      maxOutputTokens: 4500,
      promptCacheKey: `everycall-core-facts-v2-rating-batch-${batchNumber}`
    });
    const candidateById = new Map(candidates.map((fact) => [normalizeText(fact.knowledge_fact_id), fact]));
    const scoredById = new Map();
    for (const item of result.parsed.facts || []) {
      const fact = candidateById.get(normalizeText(item.fact_id));
      if (!fact) continue;
      const normalized = normalizeScoredFact(fact, item);
      if (normalized) scoredById.set(normalized.fact_id, normalized);
    }
    if (scoredById.size !== candidates.length) {
      return {
        scoredById,
        usedFallback: true,
        warning: `core_fact_model_incomplete_batch:${scoredById.size}/${candidates.length}`
      };
    }
    return { scoredById, usedFallback: false, warning: "" };
  } catch (error) {
    return {
      scoredById: new Map(),
      usedFallback: true,
      warning: `core_fact_model_fallback:${normalizeText(error?.message || "unknown")}`
    };
  }
}

async function scoreCandidatesWithModel(facts, model, companyDescription = "", modelCaller = callOpenAiJsonModel) {
  const candidates = sourceFactCandidates(facts);
  if (!candidates.length) {
    return { scoredById: new Map(), usedFallback: true, warning: "core_fact_candidates_empty" };
  }
  const scoredById = new Map();
  const warnings = [];
  let usedFallback = false;
  for (let offset = 0; offset < candidates.length; offset += CORE_FACT_LLM_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + CORE_FACT_LLM_BATCH_SIZE);
    const batchNumber = Math.floor(offset / CORE_FACT_LLM_BATCH_SIZE) + 1;
    const result = await scoreCandidateBatchWithModel(batch, model, batchNumber, companyDescription, modelCaller);
    for (const [factId, scored] of result.scoredById) scoredById.set(factId, scored);

    const missing = batch.filter((fact) => !result.scoredById.has(normalizeText(fact.knowledge_fact_id)));
    if (missing.length) {
      const retry = await scoreCandidateBatchWithModel(missing, model, `${batchNumber}-missing`, companyDescription, modelCaller);
      for (const [factId, scored] of retry.scoredById) scoredById.set(factId, scored);
      const stillMissing = missing.filter((fact) => !retry.scoredById.has(normalizeText(fact.knowledge_fact_id)));
      if (!stillMissing.length) continue;
      usedFallback = true;
      warnings.push(retry.warning || `core_fact_model_incomplete_retry:${missing.length - stillMissing.length}/${missing.length}`);
      continue;
    }

    usedFallback ||= result.usedFallback;
    if (result.warning) warnings.push(result.warning);
  }
  if (scoredById.size !== candidates.length) usedFallback = true;
  return { scoredById, usedFallback, warning: warnings.join(";") };
}

async function curateCoreFactIdsWithModel(facts, scoredById, model, companyDescription = "", modelCaller = callOpenAiJsonModel) {
  const factById = new Map(sourceFactCandidates(facts).map((fact) => [normalizeText(fact.knowledge_fact_id), fact]));
  const candidates = [...scoredById.values()]
    .filter((rating) => rating.stable_for_months && normalizeText(rating.title) && normalizeText(rating.spoken_fact))
    .map((rating) => ({
      fact_id: rating.fact_id,
      importance_score: rating.importance_score,
      title: rating.title,
      spoken_fact: rating.spoken_fact,
      rendered_line: `${rating.title}: ${rating.spoken_fact}`,
      canonical_fact: normalizeOneLine(factById.get(rating.fact_id)?.claim_text),
      reason: rating.reason
    }));
  if (!candidates.length) return { factIds: [], warning: "" };
  try {
    const result = await modelCaller({
      model: resolveCoreFactModel(model),
      system: [
        "Perform the final editorial review for a phone receptionist's known-by-heart facts.",
        "Choose only the strongest facts that callers are likely to ask about and that remain safe to say without a lookup for at least six months.",
        "Reject duplicates, contradictions, transient schedules or events, questions, headings, privacy or page-administration text, article prose, marketing fragments, generic advice, and facts conflicting with the approved company description.",
        "Reject all event operations, including games, seasons, rosters, voting, open gyms, championships, event venues, event eligibility, and participant lists, even when the fact has no explicit date.",
        "Reject website contact forms, prompts to send a message, and web-only submission instructions. The caller is already on the phone.",
        "Reject a business address or office-location fact unless the canonical fact itself contains a complete speakable address with enough city and state context for a caller to use it.",
        "Reject third-party rebates, incentive programs, utility-program qualifications, building-code requirements, regulatory guidance, and generic technical or how-to advice. These are lookup-only, not durable facts about the business.",
        "Selecting no facts is correct when no candidate clears this bar; never fill the set with weaker material.",
        "The approved company description is already in the prompt. Do not select generic restatements of it. Prefer facts that add a concrete, commonly requested detail.",
        "Reject headline-style prefixes, calls to action, second-person sales language, and broad claims about innovation, success, results, ROI, or being tailored. These are marketing copy, not by-heart facts.",
        "Reject manufacturer or product claims centered on broad benefits such as beauty, performance, flexibility, efficiency, quality, or durability unless the same fact provides a concrete product type, specification, or option that answers a common caller question.",
        "Do not fill the maximum. A strong tenant will usually have 5-10 facts. Omit overlapping paraphrases and keep at most one fact answering the same underlying caller question.",
        "Before returning, cluster candidates by the caller question they answer and keep only the strongest concrete answer from each cluster. Claims about custom, tailored, bespoke, unique, or no-off-the-shelf solutions are one overlapping idea, not separate facts.",
        "Treat the approved company description as authoritative: never select a different headquarters or base location, even if it is nearby. Reject free offers, promotions, and exact project-price ranges as volatile lookup-only details.",
        "Prefer a compact balanced set over filling the maximum: hours, service area, plain-language services, emergency posture, pricing posture, credentials, and how to get started when supported.",
        "Return only fact_ids from the supplied candidates, in best-first order. Never create or rewrite facts."
      ].join("\n"),
      user: JSON.stringify({ approved_company_description: normalizeOneLine(companyDescription), candidates }),
      schema: curatedFactsSchema,
      jsonSchemaName: "automatic_core_fact_final_review",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["fact_ids"],
        properties: {
          fact_ids: {
            type: "array",
            maxItems: CORE_FACT_MAX_PINS,
            items: { type: "string", enum: candidates.map((candidate) => candidate.fact_id) }
          }
        }
      },
      temperature: 0,
      maxOutputTokens: 800,
      promptCacheKey: "everycall-core-facts-v2-final-review"
    });
    const allowed = new Set(candidates.map((candidate) => candidate.fact_id));
    return {
      factIds: [...new Set(result.parsed.fact_ids || [])].filter((factId) => allowed.has(normalizeText(factId))),
      warning: ""
    };
  } catch (error) {
    return {
      factIds: [],
      warning: `core_fact_final_review_failed:${normalizeText(error?.message || "unknown")}`
    };
  }
}

async function rewriteCuratedCoreFactsWithModel(
  facts,
  factIds,
  scoredById,
  model,
  companyDescription = "",
  modelCaller = callOpenAiJsonModel
) {
  const factById = new Map(sourceFactCandidates(facts).map((fact) => [normalizeText(fact.knowledge_fact_id), fact]));
  const candidates = (factIds || []).map((factId) => {
    const normalizedFactId = normalizeText(factId);
    const fact = factById.get(normalizedFactId);
    const rating = scoredById instanceof Map ? scoredById.get(normalizedFactId) : null;
    if (!fact || !rating) return null;
    return {
      fact_id: normalizedFactId,
      canonical_fact: normalizeOneLine(fact.claim_text),
      current_title: normalizeOneLine(rating.title),
      current_spoken_fact: ensureSentence(rating.spoken_fact)
    };
  }).filter(Boolean);
  if (!candidates.length) return { scoredById, factIds: [], droppedUnsafeFactIds: [], warning: "" };
  if (candidates.length !== new Set((factIds || []).map((factId) => normalizeText(factId))).size) {
    return { scoredById: new Map(), factIds: [], droppedUnsafeFactIds: [], warning: `core_fact_spoken_rewrite_input_incomplete:${candidates.length}/${(factIds || []).length}` };
  }
  try {
    const result = await modelCaller({
      model: resolveCoreFactModel(model),
      system: [
        "Rewrite every selected fact into one clean atomic line for a phone receptionist's known-by-heart prompt.",
        "Remove promotional language only when it is a complete detachable phrase or clause and the concrete fact remains grammatical. Do not merely repeat current_spoken_fact when such a detachable phrase is present.",
        "Never delete an isolated modifier such as premium, professional, expert, advanced, smart, flexible, scalable, seamless, multiple, leading, proven, or superior; those words can be substantive in some industries. If promotional wording cannot be removed as a complete detachable phrase, retain the canonical wording so the later independent audit can exclude the fact safely.",
        "Keep only concrete service types, service areas, materials, product types, specifications, process steps, qualifications, or supported use cases that a caller could ask about.",
        "Use only words already present in canonical_fact, in their original order. You may delete words but may not add, substitute, reorder, infer, broaden, combine, or contradict anything.",
        "Never delete a number, negation, limit, exception, or modal qualifier such as can, may, or must. If preserving one makes the line awkward, retain the complete source wording.",
        "Write a short neutral caller-language title that describes the cleaned fact without adding scope or a new claim.",
        "Examples of the required cleanup pattern:",
        "- 'Windows and doors are available in wood, vinyl, and fiberglass, offering style flexibility, energy efficiency, and customization.' becomes 'Windows and doors are available in wood, vinyl, and fiberglass.'",
        "- 'Our team offers glass replacement for broken or foggy windows, providing honest assessments and professional installation.' becomes 'Our team offers glass replacement for broken or foggy windows.'",
        "- 'Door systems include patio and entry doors, engineered for smooth operation, durability, and energy performance with flexible design options.' becomes 'Door systems include patio and entry doors.'",
        "Return one rewrite for every supplied fact_id. Do not reject or omit a selected fact."
      ].join("\n"),
      user: JSON.stringify({ approved_company_description: normalizeOneLine(companyDescription), candidates }),
      schema: rewrittenFactsSchema,
      jsonSchemaName: "automatic_core_fact_spoken_rewrite",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["facts"],
        properties: {
          facts: {
            type: "array",
            maxItems: CORE_FACT_MAX_PINS,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fact_id", "title", "spoken_fact", "reason"],
              properties: {
                fact_id: { type: "string", enum: candidates.map((candidate) => candidate.fact_id) },
                title: { type: "string", maxLength: 80 },
                spoken_fact: { type: "string", maxLength: 320 },
                reason: { type: "string" }
              }
            }
          }
        }
      },
      temperature: 0,
      maxOutputTokens: 3600,
      promptCacheKey: "everycall-core-facts-v2-spoken-rewrite"
    });
    const rewriteById = new Map((result.parsed.facts || []).map((item) => [normalizeText(item.fact_id), item]));
    if (rewriteById.size !== candidates.length) {
      return { scoredById: new Map(), factIds: [], droppedUnsafeFactIds: [], warning: `core_fact_spoken_rewrite_incomplete:${rewriteById.size}/${candidates.length}` };
    }
    const rewrittenScores = new Map(scoredById);
    const safeFactIds = [];
    const droppedUnsafeFactIds = [];
    for (const candidate of candidates) {
      const fact = factById.get(candidate.fact_id);
      const previous = scoredById.get(candidate.fact_id);
      const rewrite = rewriteById.get(candidate.fact_id);
      const title = normalizeOneLine(rewrite?.title).replace(/:+$/g, "");
      const spokenFact = ensureSentence(rewrite?.spoken_fact);
      if (!fact
        || !previous
        || !isSafeCoreFactTitle(title, fact.claim_text)
        || !isConservativeSpokenRewrite(fact.claim_text, spokenFact)) {
        droppedUnsafeFactIds.push(candidate.fact_id);
        continue;
      }
      rewrittenScores.set(candidate.fact_id, {
        ...previous,
        title,
        spoken_fact: spokenFact,
        reason: normalizeOneLine(rewrite?.reason) || previous.reason
      });
      safeFactIds.push(candidate.fact_id);
    }
    return { scoredById: rewrittenScores, factIds: safeFactIds, droppedUnsafeFactIds, warning: "" };
  } catch (error) {
    return {
      scoredById: new Map(),
      factIds: [],
      droppedUnsafeFactIds: [],
      warning: `core_fact_spoken_rewrite_failed:${normalizeText(error?.message || "unknown")}`
    };
  }
}

export async function auditCuratedCoreFactIdsWithModel(
  facts,
  factIds,
  scoredById,
  model,
  companyDescription = "",
  modelCaller = callOpenAiJsonModel
) {
  const factById = new Map(sourceFactCandidates(facts).map((fact) => [normalizeText(fact.knowledge_fact_id), fact]));
  const candidates = (factIds || [])
    .map((factId) => {
      const normalizedFactId = normalizeText(factId);
      const fact = factById.get(normalizedFactId);
      const rating = scoredById instanceof Map ? scoredById.get(normalizedFactId) : null;
      if (!fact || !rating) return null;
      const title = normalizeOneLine(rating.title || rating.core_fact_title).replace(/:+$/g, "");
      const spokenFact = ensureSentence(rating.spoken_fact || rating.core_fact_spoken_text);
      if (!title || !spokenFact) return null;
      return {
        fact_id: fact.knowledge_fact_id,
        subject: normalizeOneLine(fact.subject),
        role: normalizeOneLine(fact.fact_role),
        canonical_fact: normalizeOneLine(fact.claim_text),
        title,
        spoken_fact: spokenFact,
        rendered_line: `${title}: ${spokenFact}`
      };
    })
    .filter(Boolean);
  if (!candidates.length) return { factIds: [], warning: "" };
  if (candidates.length !== new Set((factIds || []).map((factId) => normalizeText(factId))).size) {
    return { factIds: [], warning: `core_fact_independent_audit_input_incomplete:${candidates.length}/${(factIds || []).length}` };
  }
  try {
    const result = await modelCaller({
      model: resolveCoreFactModel(model),
      system: [
        "You are the independent final safety and editorial auditor for a phone receptionist's known-by-heart facts.",
        "Assess every supplied rendered_line separately. Callers will hear the exact title and spoken_fact together, so approve only when both are faithful to canonical_fact, complete, commonly asked, useful during a phone call, and safe to state without lookup for at least six months.",
        "Reject a title that adds or implies any unsupported scope, location, availability, credential, guarantee, urgency, product, service, audience, or other claim, even when the spoken_fact itself is accurate.",
        "The approved company description is authoritative. Reject any conflict, including a different headquarters or base city even within the same metro area.",
        "Always reject event operations: games, seasons, rosters, voting, open gyms, championships, event venues or locations, event eligibility, participating teams or schools, and participant lists.",
        "Always reject website contact forms, web submission prompts, free offers, promotions, exact project-price ranges, questions, headings, bylines, privacy or page-administration copy, article prose, generic advice, and marketing claims.",
        "Reject manufacturer or product claims centered on broad benefits such as beauty, performance, flexibility, efficiency, quality, or durability unless the same fact provides a concrete product type, specification, or option that answers a common caller question.",
        "Even when a line contains a concrete fact, reject it if removable promotional, speed, or credibility wording remains, including premium, professional, expert, honest, comprehensive, quick, quickly, fast, easy, engineered-for benefit clauses, smooth operation, durability, performance, flexibility, customization, or broad style claims.",
        "For every line, separately set marketing_language_remaining to true whenever any promotional, speed, credibility, or broad-benefit wording remains. This is a literal editorial classification, not an overall usefulness judgment. Words such as professional, expert, quick, or quickly and phrases such as 'for various architectural styles' require true even when they came directly from canonical_fact.",
        "Set approved to false whenever marketing_language_remaining is true. The caller can still get that source-backed detail through lookup; it does not belong in the by-heart block.",
        "Reject a business address or office-location fact unless the canonical fact itself contains a complete speakable address with enough city and state context for a caller to use it.",
        "Reject third-party rebates, incentive programs, utility-program qualifications, building-code requirements, regulatory guidance, and generic technical or how-to advice. These are lookup-only, not durable facts about the business.",
        "Compare the candidates as a set before assessing them. Cluster them by the caller question they answer and approve at most one fact from each overlapping cluster; when two facts overlap, approve only the strongest concrete answer and reject the other.",
        "Treat custom, tailored, bespoke, unique, and no-off-the-shelf solution claims as one overlapping idea. Do not approve several wordings of that idea.",
        "Reject facts that merely repeat another selected fact or the approved company description without adding a concrete commonly requested detail. Reject a headline-style label followed by a colon when it reads like page or marketing copy rather than a natural standalone fact.",
        "Return one assessment for every supplied fact_id. When uncertain, reject. Selecting none is acceptable."
      ].join("\n"),
      user: JSON.stringify({ approved_company_description: normalizeOneLine(companyDescription), candidates }),
      schema: auditedFactsSchema,
      jsonSchemaName: "automatic_core_fact_independent_audit",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["assessments"],
        properties: {
          assessments: {
            type: "array",
            maxItems: CORE_FACT_MAX_PINS,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fact_id", "approved", "marketing_language_remaining", "reason"],
              properties: {
                fact_id: { type: "string", enum: candidates.map((candidate) => candidate.fact_id) },
                approved: { type: "boolean" },
                marketing_language_remaining: { type: "boolean" },
                reason: { type: "string" }
              }
            }
          }
        }
      },
      temperature: 0,
      maxOutputTokens: 1400,
      promptCacheKey: "everycall-core-facts-v2-independent-audit"
    });
    const assessmentById = new Map((result.parsed.assessments || []).map((assessment) => [normalizeText(assessment.fact_id), assessment]));
    if (assessmentById.size !== candidates.length) {
      return {
        factIds: [],
        warning: `core_fact_independent_audit_incomplete:${assessmentById.size}/${candidates.length}`
      };
    }
    return {
      factIds: candidates.map((candidate) => candidate.fact_id).filter((factId) => {
        const assessment = assessmentById.get(factId);
        const candidate = candidates.find((item) => item.fact_id === factId);
        return assessment?.approved === true
          && assessment?.marketing_language_remaining === false
          && !hasCoreFactMarketingLeak(candidate?.title, candidate?.spoken_fact);
      }),
      warning: ""
    };
  } catch (error) {
    return {
      factIds: [],
      warning: `core_fact_independent_audit_failed:${normalizeText(error?.message || "unknown")}`
    };
  }
}

export function selectCoreFactsWithinBudget(facts, scoredById, options = {}) {
  const tokenBudget = Math.max(1, Number(options.tokenBudget || CORE_FACT_TOKEN_BUDGET));
  const maxPins = Math.max(1, Number(options.maxPins || CORE_FACT_MAX_PINS));
  if (!Array.isArray(options.orderedFactIds)) return { pins: [], tokenCount: 0 };
  const scored = [];
  for (const fact of sourceFactCandidates(facts)) {
    const modelScore = scoredById instanceof Map ? scoredById.get(normalizeText(fact.knowledge_fact_id)) : null;
    if (!modelScore) continue;
    const normalized = normalizeScoredFact(fact, modelScore);
    if (!normalized?.stable_for_months || !normalized.title || !normalized.spoken_fact) continue;
    scored.push({ fact, scored: normalized });
  }
  const order = new Map((options.orderedFactIds || []).map((factId, index) => [normalizeText(factId), index]));
  scored.sort((left, right) => {
    const leftIndex = order.has(left.scored.fact_id) ? order.get(left.scored.fact_id) : Number.MAX_SAFE_INTEGER;
    const rightIndex = order.has(right.scored.fact_id) ? order.get(right.scored.fact_id) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });

  const pins = [];
  const seenFingerprints = new Set();
  let usedTokens = 0;
  for (const item of scored) {
    if (!order.has(item.scored.fact_id)) continue;
    const fingerprint = createCoreFactFingerprint(item.fact);
    if (seenFingerprints.has(fingerprint)) continue;
    const line = `${item.scored.title}: ${item.scored.spoken_fact}`;
    const lineTokens = estimateTokens(`${line}\n`);
    if (usedTokens + lineTokens > tokenBudget) continue;
    pins.push({
      ...item.fact,
      is_core_fact_pinned: true,
      core_fact_fingerprint: fingerprint,
      core_fact_title: item.scored.title,
      core_fact_spoken_text: item.scored.spoken_fact,
      core_fact_score: item.scored.likelihood_score,
      core_fact_rank: pins.length + 1,
      core_fact_reason: item.scored.reason,
      core_fact_selector_version: CORE_FACT_SELECTOR_VERSION,
      core_fact_selected_at: new Date().toISOString()
    });
    seenFingerprints.add(fingerprint);
    usedTokens += lineTokens;
    if (pins.length >= maxPins) break;
  }
  return { pins, tokenCount: usedTokens };
}

export async function selectColdStartCoreFacts({
  facts,
  model,
  tokenBudget = CORE_FACT_TOKEN_BUDGET,
  companyDescription = "",
  modelCaller = callOpenAiJsonModel
} = {}) {
  const sourceFacts = Array.isArray(facts) ? facts : [];
  const creationResult = creationRatingsById(sourceFacts);
  const modelResult = creationResult.complete
    ? { scoredById: creationResult.ratings, usedFallback: false, warning: "" }
    : await scoreCandidatesWithModel(sourceFacts, model, companyDescription, modelCaller);
  const finalReview = modelResult.usedFallback
    ? { factIds: [], warning: "core_fact_rating_incomplete" }
    : await curateCoreFactIdsWithModel(
      sourceFacts,
      modelResult.scoredById,
      model,
      companyDescription,
      modelCaller
    );
  const spokenRewrite = finalReview.warning
    ? { scoredById: new Map(), factIds: [], droppedUnsafeFactIds: [], warning: "core_fact_final_review_unavailable" }
    : await rewriteCuratedCoreFactsWithModel(
      sourceFacts,
      finalReview.factIds,
      modelResult.scoredById,
      model,
      companyDescription,
      modelCaller
    );
  const independentAudit = finalReview.warning || spokenRewrite.warning
    ? { factIds: [], warning: finalReview.warning ? "core_fact_final_review_unavailable" : "core_fact_spoken_rewrite_unavailable" }
    : await auditCuratedCoreFactIdsWithModel(
      sourceFacts,
      spokenRewrite.factIds,
      spokenRewrite.scoredById,
      model,
      companyDescription,
      modelCaller
    );
  const effectiveScores = spokenRewrite.warning ? modelResult.scoredById : spokenRewrite.scoredById;
  const selection = selectCoreFactsWithinBudget(sourceFacts, effectiveScores, {
    tokenBudget,
    orderedFactIds: independentAudit.factIds
  });
  const pinById = new Map(selection.pins.map((fact) => [normalizeText(fact.knowledge_fact_id), fact]));
  return {
    facts: sourceFacts.map((fact) => {
      const fingerprint = createCoreFactFingerprint(fact);
      const pin = pinById.get(normalizeText(fact.knowledge_fact_id));
      const rating = effectiveScores.get(normalizeText(fact.knowledge_fact_id));
      return pin || {
        ...fact,
        is_core_fact_pinned: false,
        core_fact_fingerprint: fingerprint,
        core_fact_title: rating?.title || null,
        core_fact_spoken_text: rating?.spoken_fact || null,
        core_fact_score: Number.isFinite(Number(rating?.likelihood_score)) ? Number(rating.likelihood_score) : null,
        core_fact_rank: null,
        core_fact_reason: rating?.reason || null,
        core_fact_selector_version: CORE_FACT_SELECTOR_VERSION,
        core_fact_selected_at: null
      };
    }),
    pins: selection.pins,
    tokenCount: selection.tokenCount,
    selectorVersion: CORE_FACT_SELECTOR_VERSION,
    usedFallback: modelResult.usedFallback,
    droppedUnsafeRewriteFactIds: spokenRewrite.droppedUnsafeFactIds,
    warnings: [modelResult.warning, finalReview.warning, spokenRewrite.warning, independentAudit.warning].filter(Boolean)
  };
}

export async function loadPinnedCoreFacts(db, tenantKey, buildId) {
  const result = await db.query(
    `SELECT knowledge_fact_id, claim_text, fact_role, core_fact_fingerprint, core_fact_title,
            core_fact_spoken_text, core_fact_score, core_fact_rank, core_fact_reason,
            core_fact_selector_version, core_fact_selected_at
     FROM knowledge_build_facts
     WHERE tenant_key = $1
       AND build_id = $2
       AND is_core_fact_pinned = TRUE
       AND NULLIF(BTRIM(core_fact_title), '') IS NOT NULL
       AND NULLIF(BTRIM(core_fact_spoken_text), '') IS NOT NULL
     ORDER BY core_fact_rank ASC, knowledge_fact_id ASC`,
    [tenantKey, buildId]
  );
  return (result.rows || []).map((row) => ({
    ...row,
    title: normalizeOneLine(row.core_fact_title),
    spoken_text: ensureSentence(row.core_fact_spoken_text)
  }));
}

async function loadCompletedCallCount(db, tenantKey) {
  const result = await db.query(
    `SELECT COUNT(*)::bigint AS call_count
     FROM calls
     WHERE tenant_key = $1
       AND completed_at IS NOT NULL`,
    [tenantKey]
  );
  return Number(result.rows?.[0]?.call_count || 0);
}

function pinsByFingerprint(rows) {
  return new Map((rows || []).map((row) => [normalizeText(row.core_fact_fingerprint || row.fact_fingerprint), row]).filter(([fingerprint]) => fingerprint));
}

async function writePinChanges(db, { tenantKey, buildId, previousBuildId = null, previousPins = [], nextPins = [], reason, metadata = {} }) {
  const previousByFingerprint = pinsByFingerprint(previousPins);
  const nextByFingerprint = pinsByFingerprint(nextPins);
  const changes = [];
  for (const [fingerprint, pin] of nextByFingerprint) {
    const previous = previousByFingerprint.get(fingerprint);
    if (!previous) {
      changes.push({ type: "pinned", pin });
    } else if (normalizeOneLine(previous.core_fact_title) !== normalizeOneLine(pin.core_fact_title)
      || normalizeOneLine(previous.core_fact_spoken_text) !== normalizeOneLine(pin.core_fact_spoken_text)) {
      changes.push({ type: "rewritten", pin });
    }
  }
  for (const [fingerprint, pin] of previousByFingerprint) {
    if (!nextByFingerprint.has(fingerprint)) changes.push({ type: "unpinned", pin });
  }
  for (const change of changes) {
    const pin = change.pin;
    await db.query(
      `INSERT INTO knowledge_core_fact_pin_changes (
         tenant_key, build_id, previous_build_id, knowledge_fact_id, fact_fingerprint,
         change_type, title, spoken_text, claim_text, score, reason, metadata_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        tenantKey,
        buildId,
        previousBuildId,
        normalizeText(pin.knowledge_fact_id) || null,
        normalizeText(pin.core_fact_fingerprint || pin.fact_fingerprint),
        change.type,
        normalizeOneLine(pin.core_fact_title || pin.title) || null,
        ensureSentence(pin.core_fact_spoken_text || pin.spoken_text) || null,
        normalizeOneLine(pin.claim_text),
        Number.isFinite(Number(pin.core_fact_score ?? pin.score)) ? Number(pin.core_fact_score ?? pin.score) : null,
        normalizeOneLine(reason || pin.core_fact_reason || pin.reason) || null,
        JSON.stringify(metadata)
      ]
    );
  }
  return changes;
}

async function upsertRefreshState(db, tenantKey, buildId) {
  const callCount = await loadCompletedCallCount(db, tenantKey);
  await db.query(
    `INSERT INTO knowledge_core_fact_refresh_state (
       tenant_key, active_build_id, calls_at_last_refresh, last_refreshed_at, selector_version, updated_at
     )
     VALUES ($1, $2, $3, NOW(), $4, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET active_build_id = EXCLUDED.active_build_id,
                   calls_at_last_refresh = EXCLUDED.calls_at_last_refresh,
                   last_refreshed_at = NOW(),
                   selector_version = EXCLUDED.selector_version,
                   updated_at = NOW()`,
    [tenantKey, buildId, callCount, CORE_FACT_SELECTOR_VERSION]
  );
  return callCount;
}

export async function recordCoreFactActivationChanges(db, { tenantKey, buildId, previousBuildId = null, reason = "build_activated" }) {
  const [previousPins, nextPins] = await Promise.all([
    previousBuildId ? loadPinnedCoreFacts(db, tenantKey, previousBuildId) : Promise.resolve([]),
    loadPinnedCoreFacts(db, tenantKey, buildId)
  ]);
  const changes = await writePinChanges(db, {
    tenantKey,
    buildId,
    previousBuildId,
    previousPins,
    nextPins,
    reason,
    metadata: { selector_version: CORE_FACT_SELECTOR_VERSION, trigger: reason }
  });
  await upsertRefreshState(db, tenantKey, buildId);
  return { changes, pins: nextPins };
}

export async function backfillActiveBuildCoreFacts(db, {
  tenantKey,
  buildId,
  apply = false,
  replaceExisting = false,
  model = resolveCoreFactModel()
} = {}) {
  const normalizedTenantKey = normalizeText(tenantKey);
  const normalizedBuildId = normalizeText(buildId);
  if (!normalizedTenantKey || !normalizedBuildId) throw new Error("core_fact_backfill_target_required");
  const [factsResult, companyDescription] = await Promise.all([
    db.query(
      `SELECT knowledge_fact_id, tenant_key, build_id, domain_id, subject, confidence, fact_role, claim_text,
              is_core_fact_pinned, core_fact_fingerprint, core_fact_title, core_fact_spoken_text,
              core_fact_score, core_fact_rank, core_fact_reason, core_fact_selector_version,
              core_fact_selected_at
       FROM knowledge_build_facts
       WHERE tenant_key = $1
         AND build_id = $2
       ORDER BY knowledge_fact_id ASC`,
      [normalizedTenantKey, normalizedBuildId]
    ),
    loadCoreFactCompanyDescription(db, normalizedTenantKey)
  ]);
  const facts = factsResult.rows || [];
  const existingPins = facts.filter((fact) => fact.is_core_fact_pinned === true);
  if (existingPins.length && !replaceExisting) {
    return {
      tenantKey: normalizedTenantKey,
      buildId: normalizedBuildId,
      action: "skipped_existing_pins",
      factCount: facts.length,
      pinCount: existingPins.length,
      tokenCount: 0
    };
  }
  const selection = await selectColdStartCoreFacts({ facts, model, companyDescription });
  if (replaceExisting && selection.pins.length === 0 && selection.warnings.length > 0) {
    return {
      tenantKey: normalizedTenantKey,
      buildId: normalizedBuildId,
      action: "skipped_selection_unavailable",
      factCount: facts.length,
      pinCount: existingPins.length,
      tokenCount: 0,
      warnings: selection.warnings
    };
  }
  if (!apply) {
    return {
      tenantKey: normalizedTenantKey,
      buildId: normalizedBuildId,
      action: "planned",
      factCount: facts.length,
      pinCount: selection.pins.length,
      tokenCount: selection.tokenCount,
      pinFactIds: selection.pins.map((pin) => pin.knowledge_fact_id),
      pinPreviews: selection.pins.map((pin) => ({
        factId: pin.knowledge_fact_id,
        title: pin.core_fact_title,
        spokenText: pin.core_fact_spoken_text,
        score: pin.core_fact_score
      })),
      droppedUnsafeRewriteFactIds: selection.droppedUnsafeRewriteFactIds,
      warnings: selection.warnings
    };
  }

  const canBorrowClient = typeof db?.connect === "function" && typeof db?.release !== "function";
  const client = canBorrowClient ? await db.connect() : db;
  try {
    await client.query("BEGIN");
    const activeResult = await client.query(
      `SELECT active_build_id
       FROM tenant_active_knowledge_builds
       WHERE tenant_key = $1
       FOR UPDATE`,
      [normalizedTenantKey]
    );
    if (normalizeText(activeResult.rows?.[0]?.active_build_id) !== normalizedBuildId) {
      throw new Error("core_fact_active_build_changed");
    }
    const recheckPins = await loadPinnedCoreFacts(client, normalizedTenantKey, normalizedBuildId);
    if (recheckPins.length && !replaceExisting) {
      await client.query("ROLLBACK");
      return {
        tenantKey: normalizedTenantKey,
        buildId: normalizedBuildId,
        action: "skipped_existing_pins",
        factCount: facts.length,
        pinCount: recheckPins.length,
        tokenCount: 0
      };
    }
    await client.query(
      `UPDATE knowledge_build_facts
       SET is_core_fact_pinned = FALSE,
           core_fact_rank = NULL,
           core_fact_selected_at = NULL
       WHERE tenant_key = $1
         AND build_id = $2`,
      [normalizedTenantKey, normalizedBuildId]
    );
    for (const ratedFact of selection.facts) {
      await client.query(
        `UPDATE knowledge_build_facts
         SET core_fact_fingerprint = $4,
             core_fact_title = $5,
             core_fact_spoken_text = $6,
             core_fact_score = $7,
             core_fact_reason = $8,
             core_fact_selector_version = $9
         WHERE tenant_key = $1
           AND build_id = $2
           AND knowledge_fact_id = $3`,
        [
          normalizedTenantKey,
          normalizedBuildId,
          ratedFact.knowledge_fact_id,
          ratedFact.core_fact_fingerprint,
          ratedFact.core_fact_title,
          ratedFact.core_fact_spoken_text,
          ratedFact.core_fact_score,
          ratedFact.core_fact_reason,
          CORE_FACT_SELECTOR_VERSION
        ]
      );
    }
    for (const pin of selection.pins) {
      await client.query(
        `UPDATE knowledge_build_facts
         SET is_core_fact_pinned = TRUE,
             core_fact_fingerprint = $4,
             core_fact_title = $5,
             core_fact_spoken_text = $6,
             core_fact_score = $7,
             core_fact_rank = $8,
             core_fact_reason = $9,
             core_fact_selector_version = $10,
             core_fact_selected_at = NOW()
         WHERE tenant_key = $1
           AND build_id = $2
           AND knowledge_fact_id = $3`,
        [
          normalizedTenantKey,
          normalizedBuildId,
          pin.knowledge_fact_id,
          pin.core_fact_fingerprint,
          pin.core_fact_title,
          pin.core_fact_spoken_text,
          pin.core_fact_score,
          pin.core_fact_rank,
          pin.core_fact_reason,
          CORE_FACT_SELECTOR_VERSION
        ]
      );
    }
    const persistedPins = await loadPinnedCoreFacts(client, normalizedTenantKey, normalizedBuildId);
    await writePinChanges(client, {
      tenantKey: normalizedTenantKey,
      buildId: normalizedBuildId,
      previousPins: replaceExisting ? existingPins : [],
      nextPins: persistedPins,
      reason: replaceExisting ? "active_build_ai_rerank" : "active_build_backfill",
      metadata: {
        selector_version: CORE_FACT_SELECTOR_VERSION,
        trigger: replaceExisting ? "active_build_ai_rerank" : "active_build_backfill"
      }
    });
    await upsertRefreshState(client, normalizedTenantKey, normalizedBuildId);
    await client.query("COMMIT");
    return {
      tenantKey: normalizedTenantKey,
      buildId: normalizedBuildId,
      action: replaceExisting ? "replaced" : "applied",
      factCount: facts.length,
      pinCount: persistedPins.length,
      tokenCount: selection.tokenCount,
      pinFactIds: persistedPins.map((pin) => pin.knowledge_fact_id),
      droppedUnsafeRewriteFactIds: selection.droppedUnsafeRewriteFactIds,
      warnings: selection.warnings
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (canBorrowClient && typeof client?.release === "function") client.release();
  }
}

async function loadRefinementCandidates(db, tenantKey, buildId, since) {
  const [factsResult, retrievalResult] = await Promise.all([
    db.query(
      `SELECT knowledge_fact_id, tenant_key, build_id, domain_id, subject, confidence, fact_role,
              claim_text, is_core_fact_pinned, core_fact_fingerprint, core_fact_title,
              core_fact_spoken_text, core_fact_score, core_fact_rank, core_fact_reason,
              core_fact_selector_version, core_fact_selected_at
       FROM knowledge_build_facts
       WHERE tenant_key = $1
         AND build_id = $2`,
      [tenantKey, buildId]
    ),
    db.query(
      `SELECT expanded.fact_id, COUNT(*)::int AS retrieval_count
       FROM knowledge_coverage_events event
       CROSS JOIN LATERAL jsonb_array_elements_text(
         COALESCE(event.top_fact_ids_json, '[]'::jsonb)
       ) AS expanded(fact_id)
       WHERE event.tenant_key = $1
         AND event.build_id = $2
         AND event.created_at >= $3
       GROUP BY expanded.fact_id`,
      [tenantKey, buildId, since]
    )
  ]);
  const retrievalCounts = new Map((retrievalResult.rows || []).map((row) => [normalizeText(row.fact_id), Number(row.retrieval_count || 0)]));
  return (factsResult.rows || []).map((fact) => ({
    ...fact,
    retrieval_count: retrievalCounts.get(normalizeText(fact.knowledge_fact_id)) || 0
  }));
}

function storedCoreFactRatingsById(facts) {
  return new Map((facts || []).map((fact) => [normalizeText(fact.knowledge_fact_id), {
    fact_id: normalizeText(fact.knowledge_fact_id),
    title: normalizeOneLine(fact.core_fact_title),
    spoken_fact: ensureSentence(fact.core_fact_spoken_text),
    importance_score: normalizeImportanceScore(fact.core_fact_score),
    likelihood_score: Number(fact.core_fact_score || 0),
    stable_for_months: true,
    reason: normalizeOneLine(fact.core_fact_reason) || "AI importance rating"
  }]));
}

export async function selectRefinedCoreFactIdsWithModel({
  incumbents,
  candidates,
  companyDescription = "",
  model,
  modelCaller = callOpenAiJsonModel
} = {}) {
  const currentPins = Array.isArray(incumbents) ? incumbents : [];
  const eligibleCandidates = Array.isArray(candidates) ? candidates : [];
  if (!currentPins.length || !eligibleCandidates.length) {
    return { factIds: currentPins.map((fact) => normalizeText(fact.knowledge_fact_id)), warning: "" };
  }
  const candidateIds = new Set(eligibleCandidates.map((fact) => normalizeText(fact.knowledge_fact_id)));
  const pool = [...currentPins, ...eligibleCandidates].map((fact) => ({
    fact_id: normalizeText(fact.knowledge_fact_id),
    status: fact.is_core_fact_pinned ? "current_pin" : "eligible_candidate",
    title: normalizeOneLine(fact.core_fact_title),
    spoken_fact: ensureSentence(fact.core_fact_spoken_text),
    canonical_fact: normalizeOneLine(fact.claim_text),
    ai_importance_score: Math.round(normalizeImportanceScore(fact.core_fact_score)),
    retrieval_count_in_window: Number(fact.retrieval_count || 0)
  }));
  try {
    const result = await modelCaller({
      model: resolveCoreFactModel(model),
      system: [
        "Choose and order the complete known-by-heart set for a phone receptionist using AI editorial judgment.",
        "You receive every current pin and every candidate that already passed the deterministic retrieval hysteresis threshold. Those thresholds establish eligibility only; do not assume the highest retrieval count or score is automatically the most relevant fact.",
        "Use the AI importance scores and retrieval evidence as inputs, then judge the set as a whole for common caller usefulness, durable business relevance, coverage, and lack of redundancy.",
        "Return exactly the same number of facts as the current set. You may replace at most three current pins with eligible candidates. Keeping every current pin is acceptable when no candidate materially improves the set.",
        "Order the complete returned set from most important for callers to least important. This returned order is the only relevance ranking used.",
        "Reject contradictions, transient details, unsupported implications, duplicate topics, and facts that conflict with the approved company description.",
        "Return only supplied fact_ids. Never create, combine, or rewrite facts."
      ].join("\n"),
      user: JSON.stringify({
        approved_company_description: normalizeOneLine(companyDescription),
        current_pin_count: currentPins.length,
        maximum_replacements: CORE_FACT_MAX_SWAPS_PER_REFRESH,
        facts: pool
      }),
      schema: curatedFactsSchema,
      jsonSchemaName: "automatic_core_fact_refinement_review",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["fact_ids"],
        properties: {
          fact_ids: {
            type: "array",
            minItems: currentPins.length,
            maxItems: currentPins.length,
            items: { type: "string", enum: pool.map((fact) => fact.fact_id) }
          }
        }
      },
      temperature: 0,
      maxOutputTokens: 900,
      promptCacheKey: "everycall-core-facts-v2-refinement-review"
    });
    const allowed = new Set(pool.map((fact) => fact.fact_id));
    const factIds = [...new Set(result.parsed.fact_ids || [])].map(normalizeText).filter((factId) => allowed.has(factId));
    const replacementCount = factIds.filter((factId) => candidateIds.has(factId)).length;
    if (factIds.length !== currentPins.length || replacementCount > CORE_FACT_MAX_SWAPS_PER_REFRESH) {
      return {
        factIds: [],
        warning: `core_fact_refinement_review_invalid:${factIds.length}/${currentPins.length}:${replacementCount}`
      };
    }
    return { factIds, warning: "" };
  } catch (error) {
    return {
      factIds: [],
      warning: `core_fact_refinement_review_failed:${normalizeText(error?.message || "unknown")}`
    };
  }
}

async function refineCoreFactsForTenant(db, candidate) {
  const tenantKey = normalizeText(candidate.tenant_key);
  const buildId = normalizeText(candidate.active_build_id);
  const since = candidate.last_refreshed_at || new Date(Date.now() - (CORE_FACT_REFRESH_DAYS * 24 * 60 * 60 * 1000));
  const [facts, companyDescription] = await Promise.all([
    loadRefinementCandidates(db, tenantKey, buildId, since),
    loadCoreFactCompanyDescription(db, tenantKey)
  ]);
  const incumbents = facts.filter((fact) => fact.is_core_fact_pinned).sort((left, right) => Number(left.core_fact_rank || 999) - Number(right.core_fact_rank || 999));
  const candidates = facts
    .filter((fact) => !fact.is_core_fact_pinned
      && normalizeText(fact.core_fact_title)
      && normalizeText(fact.core_fact_spoken_text)
      && Number(fact.retrieval_count || 0) >= CORE_FACT_MIN_CANDIDATE_RETRIEVALS
      && incumbents.some((incumbent) => Number(fact.retrieval_count || 0)
        >= Number(incumbent.retrieval_count || 0) + CORE_FACT_RETRIEVAL_MARGIN));

  if (!incumbents.length || !candidates.length) {
    await upsertRefreshState(db, tenantKey, buildId);
    return { tenantKey, buildId, action: "reviewed", swaps: 0 };
  }

  const refinementReview = await selectRefinedCoreFactIdsWithModel({
    incumbents,
    candidates,
    companyDescription
  });
  if (refinementReview.warning || !refinementReview.factIds.length) {
    await upsertRefreshState(db, tenantKey, buildId);
    return { tenantKey, buildId, action: "reviewed", swaps: 0, warning: refinementReview.warning || "core_fact_refinement_empty" };
  }

  const pool = [...incumbents, ...candidates];
  const poolById = new Map(pool.map((fact) => [normalizeText(fact.knowledge_fact_id), fact]));
  const ratingsById = storedCoreFactRatingsById(pool);
  const independentAudit = await auditCuratedCoreFactIdsWithModel(
    pool,
    refinementReview.factIds,
    ratingsById,
    undefined,
    companyDescription
  );
  if (independentAudit.warning || independentAudit.factIds.length !== refinementReview.factIds.length) {
    await upsertRefreshState(db, tenantKey, buildId);
    return {
      tenantKey,
      buildId,
      action: "reviewed",
      swaps: 0,
      warning: independentAudit.warning || `core_fact_refinement_audit_rejected:${independentAudit.factIds.length}/${refinementReview.factIds.length}`
    };
  }

  const projectedTokens = independentAudit.factIds.reduce((total, factId) => {
    const fact = poolById.get(normalizeText(factId));
    return total + estimateTokens(`${normalizeOneLine(fact?.core_fact_title)}: ${ensureSentence(fact?.core_fact_spoken_text)}\n`);
  }, 0);
  if (projectedTokens > CORE_FACT_TOKEN_BUDGET) {
    await upsertRefreshState(db, tenantKey, buildId);
    return { tenantKey, buildId, action: "reviewed", swaps: 0, warning: `core_fact_refinement_token_budget:${projectedTokens}` };
  }

  const nextPins = independentAudit.factIds.map((factId, index) => ({
    ...poolById.get(normalizeText(factId)),
    is_core_fact_pinned: true,
    core_fact_rank: index + 1,
    core_fact_selected_at: new Date().toISOString()
  }));
  const incumbentIds = new Set(incumbents.map((fact) => normalizeText(fact.knowledge_fact_id)));
  const replacementCount = nextPins.filter((fact) => !incumbentIds.has(normalizeText(fact.knowledge_fact_id))).length;
  const previousOrder = incumbents.map((fact) => normalizeText(fact.knowledge_fact_id));
  const nextOrder = nextPins.map((fact) => normalizeText(fact.knowledge_fact_id));
  if (replacementCount === 0 && previousOrder.every((factId, index) => factId === nextOrder[index])) {
    await upsertRefreshState(db, tenantKey, buildId);
    return { tenantKey, buildId, action: "reviewed", swaps: 0 };
  }
  const previousPins = await loadPinnedCoreFacts(db, tenantKey, buildId);

  await db.query("BEGIN");
  try {
    const activeResult = await db.query(
      `SELECT active_build_id
       FROM tenant_active_knowledge_builds
       WHERE tenant_key = $1
       FOR UPDATE`,
      [tenantKey]
    );
    if (normalizeText(activeResult.rows?.[0]?.active_build_id) !== buildId) throw new Error("core_fact_active_build_changed");
    await db.query(
      `UPDATE knowledge_build_facts
       SET is_core_fact_pinned = FALSE,
           core_fact_rank = NULL,
           core_fact_selected_at = NULL
       WHERE tenant_key = $1
         AND build_id = $2
         AND is_core_fact_pinned = TRUE`,
      [tenantKey, buildId]
    );
    for (const pin of nextPins) {
      await db.query(
        `UPDATE knowledge_build_facts
         SET is_core_fact_pinned = TRUE,
             core_fact_fingerprint = $4,
             core_fact_title = $5,
             core_fact_spoken_text = $6,
             core_fact_score = $7,
             core_fact_rank = $8,
             core_fact_reason = $9,
             core_fact_selector_version = $10,
             core_fact_selected_at = NOW()
         WHERE tenant_key = $1
           AND build_id = $2
           AND knowledge_fact_id = $3`,
        [
          tenantKey,
          buildId,
          pin.knowledge_fact_id,
          pin.core_fact_fingerprint || createCoreFactFingerprint(pin),
          pin.core_fact_title,
          pin.core_fact_spoken_text,
          pin.core_fact_score,
          pin.core_fact_rank,
          pin.core_fact_reason,
          CORE_FACT_SELECTOR_VERSION
        ]
      );
    }
    const persistedPins = await loadPinnedCoreFacts(db, tenantKey, buildId);
    await writePinChanges(db, {
      tenantKey,
      buildId,
      previousBuildId: buildId,
      previousPins,
      nextPins: persistedPins,
      reason: "retrieval_refinement",
      metadata: {
        selector_version: CORE_FACT_SELECTOR_VERSION,
        trigger: "retrieval_refinement",
        max_swaps: CORE_FACT_MAX_SWAPS_PER_REFRESH,
        retrieval_margin: CORE_FACT_RETRIEVAL_MARGIN
      }
    });
    await upsertRefreshState(db, tenantKey, buildId);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  return { tenantKey, buildId, action: "refined", swaps: replacementCount };
}

export async function runCoreFactRefinementJobs(db, { maxTenants = 1 } = {}) {
  const result = await db.query(
    `SELECT pointer.tenant_key,
            pointer.active_build_id,
            state.last_refreshed_at,
            COALESCE(state.calls_at_last_refresh, 0)::bigint AS calls_at_last_refresh,
            COUNT(calls.call_sid)::bigint AS completed_call_count
     FROM tenant_active_knowledge_builds pointer
     LEFT JOIN knowledge_core_fact_refresh_state state
       ON state.tenant_key = pointer.tenant_key
      AND state.active_build_id = pointer.active_build_id
     LEFT JOIN calls
       ON calls.tenant_key = pointer.tenant_key
      AND calls.completed_at IS NOT NULL
     GROUP BY pointer.tenant_key, pointer.active_build_id, state.last_refreshed_at, state.calls_at_last_refresh
     HAVING state.last_refreshed_at IS NULL
         OR state.last_refreshed_at <= NOW() - ($1::int * INTERVAL '1 day')
         OR COUNT(calls.call_sid) >= COALESCE(state.calls_at_last_refresh, 0) + $2
     ORDER BY state.last_refreshed_at ASC NULLS FIRST, pointer.tenant_key ASC
     LIMIT $3`,
    [CORE_FACT_REFRESH_DAYS, CORE_FACT_REFRESH_CALLS, Math.max(1, Number(maxTenants || 1))]
  );
  const runs = [];
  for (const row of result.rows || []) {
    const canBorrowClient = typeof db?.connect === "function" && typeof db?.release !== "function";
    const client = canBorrowClient ? await db.connect() : db;
    try {
      const lockResult = await client.query(
        `SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked`,
        ["knowledge_core_facts", normalizeText(row.tenant_key)]
      );
      if (!lockResult.rows?.[0]?.locked) {
        runs.push({
          tenantKey: normalizeText(row.tenant_key),
          buildId: normalizeText(row.active_build_id),
          action: "skipped_locked"
        });
        continue;
      }
      try {
        runs.push(await refineCoreFactsForTenant(client, row));
      } finally {
        await client.query(
          `SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`,
          ["knowledge_core_facts", normalizeText(row.tenant_key)]
        ).catch(() => {});
      }
    } catch (error) {
      runs.push({
        tenantKey: normalizeText(row.tenant_key),
        buildId: normalizeText(row.active_build_id),
        action: "failed",
        error: normalizeText(error?.message || "core_fact_refinement_failed")
      });
    } finally {
      if (canBorrowClient && typeof client?.release === "function") client.release();
    }
  }
  return { consideredTenants: (result.rows || []).length, runs };
}
