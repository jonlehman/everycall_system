import crypto from "node:crypto";
import {
  deterministicAnswerPacketSchema,
  type DeterministicAnswerPacket,
  type RetrievedFactSupport
} from "./knowledgePlannerRuntime.js";

type QueryResult = { rows?: Array<Record<string, any>> | null };
type Queryable = { query: (text: string, values?: unknown[]) => Promise<QueryResult> };

const MATCH_MIN = Number.parseFloat(String(process.env.KNOWS_BY_HEART_MATCH_MIN || "0.84"));
const MATCH_MARGIN = Number.parseFloat(String(process.env.KNOWS_BY_HEART_MATCH_MARGIN || "0.04"));

function normalizeText(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function ensureSentence(value: unknown) {
  const text = normalizeText(value);
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}

function sha256(value: unknown) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function uniqueValues(values: Iterable<unknown>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function categoryForQuery(value: unknown) {
  const text = normalizeText(value).toLowerCase();
  if (/\b(?:price|pricing|costs?|rates?|per\s+(?:hour|square|sq\.?\s*ft)|starts?\s+at|\$\s*\d)/i.test(text)) return "pricing";
  if (/\b(?:free|paid|written|complimentary)?\s*(?:estimate|quote|consultation)\b/i.test(text)) return "estimate_policy";
  if (/\b(?:hours?|open|close[ds]?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) return "hours";
  if (/\b(?:emergency|after[- ]hours|24\s*\/\s*7|on[- ]call)\b/i.test(text)) return "emergency_availability";
  if (/\b(?:service area|serves?|serving|located|location|county|counties|region|miles? radius)\b/i.test(text)) return "service_area";
  if (/\b(?:repair|maintenance|service calls?|fix(?:es|ing)?)\b/i.test(text)) return "repairs_service";
  if (/\b(?:warranty|guarantee)\b/i.test(text)) return "warranty_guarantee";
  if (/\b(?:licensed|insured|bonded|license)\b/i.test(text)) return "licensing_insurance";
  if (/\b(?:financing|payment|credit card|cash|check)\b/i.test(text)) return "payment_financing";
  if (/\b(?:schedule|appointment|booking|contact|call back|callback)\b/i.test(text)) return "contact_scheduling";
  if (/\b(?:install|replace|paint|build|offer|provide|specializ|services?)\b/i.test(text)) return "services";
  return "company_background";
}

function semanticTokens(value: unknown) {
  return uniqueValues(normalizeText(value).toLowerCase().split(/[^a-z0-9]+/g).filter((token) => token.length >= 3));
}

function subjectRelevance(queryText: string, tenantFact: Record<string, any>) {
  if (categoryForQuery(queryText) === normalizeText(tenantFact.category)) return 1;
  const queryTokens = new Set(semanticTokens(queryText));
  const subjectTokens = semanticTokens(tenantFact.subject_text);
  if (!subjectTokens.length) return 0;
  return subjectTokens.filter((token) => queryTokens.has(token)).length / subjectTokens.length;
}

function hashedEmbedding(value: unknown, dimensions = 128) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const text = `  ${normalizeText(value).toLowerCase()}  `;
  for (let index = 0; index <= text.length - 3; index += 1) {
    const digest = crypto.createHash("sha256").update(text.slice(index, index + 3)).digest();
    const position = digest.readUInt32BE(0) % dimensions;
    vector[position] = (vector[position] || 0) + ((digest[4] || 0) % 2 === 0 ? 1 : -1);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => item / magnitude);
}

function cosine(left: number[], right: number[]) {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftSq = 0;
  let rightSq = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    dot += leftValue * rightValue;
    leftSq += leftValue * leftValue;
    rightSq += rightValue * rightValue;
  }
  return leftSq && rightSq ? dot / Math.sqrt(leftSq * rightSq) : 0;
}

function estimateTokenCount(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

async function resolveLineageTargets(db: Queryable, tenantKey: string, revisionId: string | null, lineageKeys: string[]) {
  const roots = uniqueValues(lineageKeys);
  if (!roots.length || !revisionId) return new Map<string, Array<{ candidateId: string; lineageKey: string }>>();
  const result = await db.query(
    `WITH RECURSIVE lineage_path AS (
       SELECT seed.lineage_key AS root_lineage_key, seed.id AS candidate_id, seed.revision_id, 0 AS depth
       FROM kb_candidates seed
       WHERE seed.tenant_key = $1 AND seed.lineage_key = ANY($2::text[])
       UNION
       SELECT path.root_lineage_key, link.to_candidate_id, link.to_revision_id, path.depth + 1
       FROM lineage_path path
       INNER JOIN kb_lineage link ON link.from_candidate_id = path.candidate_id
       WHERE link.to_candidate_id IS NOT NULL AND path.depth < 50
     )
     SELECT DISTINCT path.root_lineage_key, current.id AS candidate_id, current.lineage_key
     FROM lineage_path path
     INNER JOIN kb_candidates current ON current.id = path.candidate_id
     WHERE current.revision_id = $3`,
    [tenantKey, roots, revisionId]
  );
  const resolved = new Map<string, Array<{ candidateId: string; lineageKey: string }>>(roots.map((root) => [root, []]));
  for (const row of result.rows || []) {
    const items = resolved.get(normalizeText(row.root_lineage_key)) || [];
    if (!items.some((item) => item.candidateId === row.candidate_id)) {
      items.push({ candidateId: row.candidate_id, lineageKey: row.lineage_key });
    }
    resolved.set(normalizeText(row.root_lineage_key), items);
  }
  return resolved;
}

/** Shared §9g.4 overlay. This is deliberately inside contracts so preview and
 * the live gateway execute the same correction/exclusion path. */
export async function applyTenantFactsToSharedPlannerRuntime<T extends {
  answerPacket: DeterministicAnswerPacket;
  factResultsByCoverageItem: Record<string, RetrievedFactSupport[]>;
}>(db: Queryable, tenantKey: string, queryText: string, runtimeResult: T): Promise<T & {
  kbTenantFactOverlay?: { tenantFactIds: string[]; exclusions: Array<Record<string, string>> };
}> {
  const tenantFactsResult = await db.query(
    `SELECT * FROM kb_tenant_facts
     WHERE tenant_key = $1 AND archived_at IS NULL
     ORDER BY effective_score DESC, created_at ASC, id ASC`,
    [tenantKey]
  ).catch((error) => {
    console.error("kb_tenant_fact_overlay_lookup_failed", {
      tenantKey,
      error: error instanceof Error ? error.message : String(error)
    });
    return { rows: [] };
  });
  const relevantFacts = (tenantFactsResult.rows || []).filter((fact) => subjectRelevance(queryText, fact) >= 0.34);
  if (!relevantFacts.length) return runtimeResult;

  const allFactRows = Object.values(runtimeResult.factResultsByCoverageItem || {}).flat();
  const factIds = uniqueValues(allFactRows.map((row) => row.knowledge_fact_id));
  const candidateResult = factIds.length ? await db.query(
    `SELECT candidate.id, candidate.revision_id, candidate.source_knowledge_fact_id,
            candidate.lineage_key, candidate.category, candidate.subject_text
     FROM kb_candidates candidate
     INNER JOIN kb_catalog_revisions revision ON revision.id = candidate.revision_id
     WHERE candidate.tenant_key = $1 AND revision.knowledge_build_id = $2
       AND candidate.source_knowledge_fact_id = ANY($3::text[])`,
    [tenantKey, runtimeResult.answerPacket.build_id, factIds]
  ) : { rows: [] };
  const candidateByFactId = new Map((candidateResult.rows || []).map((row) => [normalizeText(row.source_knowledge_fact_id), row]));
  const currentRevisionId = normalizeText(candidateResult.rows?.[0]?.revision_id) || null;
  const resolvedCorrectionLineages = await resolveLineageTargets(
    db,
    tenantKey,
    currentRevisionId,
    relevantFacts.map((fact) => normalizeText(fact.superseded_lineage_key)).filter(Boolean)
  );
  const resolvedByTenantFact = new Map(relevantFacts.map((fact) => [
    fact.id,
    new Set((resolvedCorrectionLineages.get(normalizeText(fact.superseded_lineage_key)) || []).map((item) => item.candidateId))
  ]));
  const candidates = [...candidateByFactId.values()];
  const identityScores = new Map<string, number>();
  for (const tenantFact of relevantFacts) {
    for (const candidate of candidates) {
      if (tenantFact.category !== candidate.category) continue;
      identityScores.set(`${tenantFact.id}:${candidate.id}`, cosine(hashedEmbedding(tenantFact.subject_text), hashedEmbedding(candidate.subject_text)));
    }
  }
  const boundedMatch = (tenantFact: Record<string, any>, candidate: Record<string, any>) => {
    if (tenantFact.category !== candidate.category) return false;
    const score = identityScores.get(`${tenantFact.id}:${candidate.id}`) || 0;
    const tenantRunner = candidates.filter((item) => item.category === tenantFact.category && item.id !== candidate.id)
      .map((item) => identityScores.get(`${tenantFact.id}:${item.id}`) || 0).sort((a, b) => b - a)[0] || 0;
    const candidateRunner = relevantFacts.filter((item) => item.category === candidate.category && item.id !== tenantFact.id)
      .map((item) => identityScores.get(`${item.id}:${candidate.id}`) || 0).sort((a, b) => b - a)[0] || 0;
    return score >= MATCH_MIN && score - tenantRunner >= MATCH_MARGIN && score - candidateRunner >= MATCH_MARGIN;
  };

  const excludedFactIds = new Set<string>();
  const exclusions: Array<Record<string, string>> = [];
  for (const row of allFactRows) {
    const candidate = candidateByFactId.get(row.knowledge_fact_id);
    if (!candidate) continue;
    for (const tenantFact of relevantFacts) {
      const direct = resolvedByTenantFact.get(tenantFact.id)?.has(candidate.id)
        || (normalizeText(tenantFact.superseded_lineage_key) && normalizeText(tenantFact.superseded_lineage_key) === normalizeText(candidate.lineage_key));
      if (!direct && !boundedMatch(tenantFact, candidate)) continue;
      excludedFactIds.add(row.knowledge_fact_id);
      exclusions.push({
        knowledgeFactId: row.knowledge_fact_id,
        tenantFactId: tenantFact.id,
        reason: direct ? "superseded_lineage_key" : "lineage_loss_subject_identity"
      });
      break;
    }
  }

  const tenantSupports: RetrievedFactSupport[] = relevantFacts.map((fact) => ({
    coverage_item_text: queryText,
    knowledge_fact_id: fact.id,
    fact_role: "direct_answer",
    claim_text: normalizeText(fact.canonical_text),
    support_type: "tenant_asserted",
    similarity: 1,
    topic_name: normalizeText(fact.title) || null,
    subtopic_name: null,
    qualifiers: asArray(fact.qualifiers_json).map(normalizeText).filter(Boolean),
    boundary_notes: asArray(fact.boundaries_json).map(normalizeText).filter(Boolean),
    next_steps: [], source_ref_ids: [], source_chunk_ids: [], card_ids: [],
    metadata: {
      tenant_fact_id: fact.id,
      authority: "tenant",
      pricing_origin: fact.price_authorized_by_tenant ? "tenant_authorized" : "tenant_unapproved",
      pricing_source_hash: sha256(JSON.stringify(fact))
    }
  }));
  const factResultsByCoverageItem: Record<string, RetrievedFactSupport[]> = {};
  for (const [coverageItem, facts] of Object.entries(runtimeResult.factResultsByCoverageItem || {})) {
    factResultsByCoverageItem[coverageItem] = [
      ...tenantSupports.map((support) => ({ ...support, coverage_item_text: coverageItem })),
      ...facts.filter((fact) => !excludedFactIds.has(fact.knowledge_fact_id))
    ];
  }

  const answerPacket = structuredClone(runtimeResult.answerPacket);
  const tenantClaims = relevantFacts.map((fact) => ensureSentence(fact.canonical_text));
  const excludedClaims = new Set(allFactRows.filter((row) => excludedFactIds.has(row.knowledge_fact_id)).map((row) => normalizeText(row.claim_text).toLowerCase()));
  answerPacket.direct_answer_points = uniqueValues([
    ...tenantClaims,
    ...answerPacket.direct_answer_points.filter((claim) => !excludedClaims.has(normalizeText(claim).toLowerCase()))
  ]);
  answerPacket.used_fact_ids = uniqueValues([
    ...relevantFacts.map((fact) => fact.id),
    ...answerPacket.used_fact_ids.filter((id) => !excludedFactIds.has(id))
  ]);
  answerPacket.runtime_mode = answerPacket.direct_answer_points.length ? "answer" : answerPacket.runtime_mode;
  answerPacket.metadata = {
    ...asRecord(answerPacket.metadata),
    tenant_fact_ids: relevantFacts.map((fact) => fact.id),
    tenant_fact_exclusions: exclusions
  };
  answerPacket.coverage = answerPacket.coverage.map((coverage) => ({
    ...coverage,
    support_strength: tenantClaims.length ? "strong" as const : coverage.support_strength,
    direct_answer_points: uniqueValues([
      ...tenantClaims,
      ...coverage.direct_answer_points.filter((claim) => !excludedClaims.has(normalizeText(claim).toLowerCase()))
    ]),
    used_fact_ids: uniqueValues([
      ...relevantFacts.map((fact) => fact.id),
      ...coverage.used_fact_ids.filter((id) => !excludedFactIds.has(id))
    ])
  }));
  answerPacket.token_counts.packet_tokens = estimateTokenCount({ ...answerPacket, token_counts: null });
  const parsedPacket = deterministicAnswerPacketSchema.parse(answerPacket);
  for (const exclusion of exclusions) console.warn("kb_lookup_candidate_excluded", { tenantKey, ...exclusion });
  return {
    ...runtimeResult,
    answerPacket: parsedPacket,
    factResultsByCoverageItem,
    kbTenantFactOverlay: { tenantFactIds: relevantFacts.map((fact) => fact.id), exclusions }
  };
}
