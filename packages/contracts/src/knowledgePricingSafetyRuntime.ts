import crypto from "node:crypto";
import {
  deterministicAnswerPacketSchema,
  type DeterministicAnswerPacket,
  type RetrievedCardSupport,
  type RetrievedFactSupport
} from "./knowledgePlannerRuntime.js";

export const PRICING_SAFETY_PROCESSING_VERSION = "pricing_safety_v19_rev_g_v1";
export const GENERIC_PRICE_FREE_RESTATEMENT = "Pricing depends on the details of the work, and the team can follow up about the next step.";

export type PricingPacketOrigin =
  | "caller"
  | "planner_generated"
  | "website_or_upload"
  | "tenant_unapproved"
  | "tenant_authorized";

export type PacketProvenanceEntry = {
  origin: PricingPacketOrigin;
  source_hash: string;
};

export type PacketProvenanceByPath = Record<string, PacketProvenanceEntry>;

type QueryResult = { rows?: Array<Record<string, any>> | null };
type Queryable = { query: (text: string, values?: unknown[]) => Promise<QueryResult> };

function normalizeText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [];
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

const CURRENCY_SYMBOL_PATTERN = /\p{Sc}/u;
const CURRENCY_CODE_PATTERN = /\b(?:USD|CAD|EUR|GBP|AUD|NZD)\b/iu;
const CURRENCY_WORD_PATTERN = /\b(?:dollars?|cents?|bucks?|euros?|pounds?\s+sterling)\b/iu;
const MAGNITUDE_SHORTHAND_PATTERN = /\b\d+(?:\.\d+)?\s*[kKmM]\b/u;

export function containsMonetaryOrRateExpression(value: unknown) {
  const text = normalizeText(value);
  if (!text) return false;
  const textWithoutPhoneNumbers = text
    .replace(/\b(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/gu, " ")
    .replace(/\b\d{3}[\s.-]\d{4}\b/gu, " ")
    .replace(/\b\d{7,15}\b/gu, " ");
  return CURRENCY_SYMBOL_PATTERN.test(text)
    || CURRENCY_CODE_PATTERN.test(text)
    || CURRENCY_WORD_PATTERN.test(text)
    || MAGNITUDE_SHORTHAND_PATTERN.test(text)
    || /\b(?:price|pricing|cost|rate|fee|minimum|ballpark|estimated?\s+amount|starts?\s+at|range)\b.{0,28}\p{Nd}/iu.test(textWithoutPhoneNumbers)
    || /\p{Nd}.{0,24}\b(?:per|an?\s+hour|square\s+foot|sq\.?\s*ft|gallon|day|visit|job)\b/iu.test(textWithoutPhoneNumbers);
}

function artifactValue(row: Record<string, any> | undefined) {
  return asRecord(row?.value_json);
}

function restatementFor(row: Record<string, any> | undefined) {
  const value = artifactValue(row);
  return normalizeText(value.spoken) || GENERIC_PRICE_FREE_RESTATEMENT;
}

function suppressionRequired(row: Record<string, any> | undefined) {
  return !row || artifactValue(row).suppression_required !== false;
}

async function loadPricingArtifacts(db: Queryable, input: {
  tenantKey: string;
  buildId: string;
  factIds: string[];
  cardIds: string[];
}) {
  const candidateRows = input.factIds.length
    ? await db.query(
      `SELECT candidate.source_knowledge_fact_id AS support_id,
              artifact.value_json, artifact.created_at, artifact.id
       FROM kb_candidates candidate
       INNER JOIN kb_catalog_revisions revision ON revision.id = candidate.revision_id
       LEFT JOIN LATERAL (
         SELECT value_json, created_at, id
         FROM kb_pricing_safety_artifacts pricing
         WHERE pricing.tenant_key = candidate.tenant_key
           AND pricing.build_id = revision.knowledge_build_id
           AND pricing.target_type = 'candidate'
           AND pricing.target_id = candidate.id
           AND pricing.processing_version = $4
         ORDER BY pricing.created_at DESC, pricing.id DESC
         LIMIT 1
       ) artifact ON TRUE
       WHERE candidate.tenant_key = $1
         AND revision.knowledge_build_id = $2
         AND candidate.source_knowledge_fact_id = ANY($3::text[])`,
      [input.tenantKey, input.buildId, input.factIds, PRICING_SAFETY_PROCESSING_VERSION]
    ).catch((error) => {
      console.error("pricing_safety_artifact_lookup_failed", {
        tenantKey: input.tenantKey,
        buildId: input.buildId,
        targetType: "candidate",
        error: error instanceof Error ? error.message : String(error)
      });
      return { rows: [] };
    })
    : { rows: [] };
  const cardRows = input.cardIds.length
    ? await db.query(
      `SELECT target_id AS support_id, value_json, created_at, id
       FROM kb_pricing_safety_artifacts
       WHERE tenant_key = $1 AND build_id = $2
         AND target_type = 'card'
         AND target_id = ANY($3::text[])
         AND processing_version = $4
       ORDER BY target_id, created_at DESC, id DESC`,
      [input.tenantKey, input.buildId, input.cardIds, PRICING_SAFETY_PROCESSING_VERSION]
    ).catch((error) => {
      console.error("pricing_safety_artifact_lookup_failed", {
        tenantKey: input.tenantKey,
        buildId: input.buildId,
        targetType: "card",
        error: error instanceof Error ? error.message : String(error)
      });
      return { rows: [] };
    })
    : { rows: [] };
  const candidateByFactId = new Map<string, Record<string, any>>();
  for (const row of candidateRows.rows || []) {
    if (row.value_json && !candidateByFactId.has(normalizeText(row.support_id))) {
      candidateByFactId.set(normalizeText(row.support_id), row);
    }
  }
  const cardById = new Map<string, Record<string, any>>();
  for (const row of cardRows.rows || []) {
    if (row.value_json && !cardById.has(normalizeText(row.support_id))) {
      cardById.set(normalizeText(row.support_id), row);
    }
  }
  return { candidateByFactId, cardById };
}

function sanitizedFact(fact: RetrievedFactSupport, restatement: string, reason: string): RetrievedFactSupport {
  return {
    ...fact,
    fact_role: "answer",
    claim_text: restatement,
    qualifiers: [],
    boundary_notes: [],
    next_steps: [],
    metadata: {
      ...asRecord(fact.metadata),
      pricing_origin: "website_or_upload",
      pricing_sanitized: true,
      pricing_safety_reason: reason,
      pricing_source_hash: sha256(JSON.stringify(fact))
    }
  };
}

function sanitizedCard(card: RetrievedCardSupport, restatement: string, reason: string): RetrievedCardSupport {
  return {
    ...card,
    canonical_name: "Pricing information",
    summary: restatement,
    support_summary: restatement,
    metadata: {
      ...asRecord(card.metadata),
      pricing_origin: "website_or_upload",
      pricing_sanitized: true,
      pricing_safety_reason: reason,
      pricing_source_hash: sha256(JSON.stringify(card))
    }
  };
}

export async function sanitizePricingSupport(db: Queryable, input: {
  tenantKey: string;
  buildId: string;
  cardResultsByCoverageItem: Record<string, RetrievedCardSupport[]>;
  factResultsByCoverageItem: Record<string, RetrievedFactSupport[]>;
}) {
  const allFacts = Object.values(input.factResultsByCoverageItem).flat();
  const allCards = Object.values(input.cardResultsByCoverageItem).flat();
  const linkedFactIds = allCards.flatMap((card) => card.fact_ids || []);
  const factIds = uniqueValues([...allFacts.map((fact) => fact.knowledge_fact_id), ...linkedFactIds]);
  const cardIds = uniqueValues(allCards.map((card) => card.knowledge_card_id));
  const { candidateByFactId, cardById } = await loadPricingArtifacts(db, {
    tenantKey: input.tenantKey,
    buildId: input.buildId,
    factIds,
    cardIds
  });
  const missing: Array<{ targetType: string; targetId: string }> = [];
  const factResultsByCoverageItem: Record<string, RetrievedFactSupport[]> = {};
  const cardResultsByCoverageItem: Record<string, RetrievedCardSupport[]> = {};

  const coverageItems = uniqueValues([
    ...Object.keys(input.factResultsByCoverageItem),
    ...Object.keys(input.cardResultsByCoverageItem)
  ]);
  for (const coverageItem of coverageItems) {
    const facts = input.factResultsByCoverageItem[coverageItem] || [];
    let coverageRestatement = "";
    factResultsByCoverageItem[coverageItem] = facts.map((fact) => {
      const artifact = candidateByFactId.get(fact.knowledge_fact_id);
      if (!artifact) missing.push({ targetType: "candidate", targetId: fact.knowledge_fact_id });
      if (!suppressionRequired(artifact)) {
        return {
          ...fact,
          metadata: {
            ...asRecord(fact.metadata),
            pricing_origin: "website_or_upload",
            pricing_source_hash: sha256(JSON.stringify(fact))
          }
        };
      }
      coverageRestatement ||= restatementFor(artifact);
      return sanitizedFact(fact, coverageRestatement, artifact ? "suppression_required" : "pricing_safety_missing");
    });

    cardResultsByCoverageItem[coverageItem] = (input.cardResultsByCoverageItem[coverageItem] || []).map((card) => {
      const cardArtifact = cardById.get(card.knowledge_card_id);
      const linkedArtifacts = (card.fact_ids || []).map((factId) => candidateByFactId.get(factId));
      const unresolvedLinkedFact = !(card.fact_ids || []).length || linkedArtifacts.some((artifact) => !artifact);
      const linkedSuppression = linkedArtifacts.some((artifact) => suppressionRequired(artifact));
      const unsafe = suppressionRequired(cardArtifact) || unresolvedLinkedFact || linkedSuppression;
      if (!cardArtifact) missing.push({ targetType: "card", targetId: card.knowledge_card_id });
      if (unresolvedLinkedFact) {
        for (const factId of card.fact_ids || []) {
          if (!candidateByFactId.has(factId)) missing.push({ targetType: "candidate", targetId: factId });
        }
      }
      if (!unsafe) {
        return {
          ...card,
          metadata: {
            ...asRecord(card.metadata),
            pricing_origin: "website_or_upload",
            pricing_source_hash: sha256(JSON.stringify(card))
          }
        };
      }
      const linkedRestatement = linkedArtifacts.find((artifact) => suppressionRequired(artifact));
      coverageRestatement ||= restatementFor(linkedRestatement || cardArtifact);
      return sanitizedCard(card, coverageRestatement, !cardArtifact || unresolvedLinkedFact
        ? "pricing_safety_missing"
        : "suppression_required");
    });
  }

  for (const item of missing) {
    console.warn("pricing_safety_missing", {
      tenantKey: input.tenantKey,
      buildId: input.buildId,
      ...item
    });
  }
  return {
    cardResultsByCoverageItem,
    factResultsByCoverageItem,
    missing
  };
}

function originFromMetadata(metadata: unknown): PricingPacketOrigin {
  const origin = normalizeText(asRecord(metadata).pricing_origin) as PricingPacketOrigin;
  return ["caller", "planner_generated", "website_or_upload", "tenant_unapproved", "tenant_authorized"].includes(origin)
    ? origin
    : "website_or_upload";
}

function registerValueOrigin(map: Map<string, PacketProvenanceEntry>, value: unknown, origin: PricingPacketOrigin, hash?: string) {
  const text = normalizeText(value);
  if (!text) return;
  const current = map.get(text.toLowerCase());
  if (current?.origin === "tenant_authorized") return;
  map.set(text.toLowerCase(), { origin, source_hash: hash || sha256(text) });
}

export function buildPacketProvenance(input: {
  packet: DeterministicAnswerPacket;
  coverageItemOrigins: Map<string, PricingPacketOrigin>;
  cardResultsByCoverageItem: Record<string, RetrievedCardSupport[]>;
  factResultsByCoverageItem: Record<string, RetrievedFactSupport[]>;
}): PacketProvenanceByPath {
  const provenance: PacketProvenanceByPath = {};
  const byValue = new Map<string, PacketProvenanceEntry>();
  for (const facts of Object.values(input.factResultsByCoverageItem)) {
    for (const fact of facts) {
      const metadata = asRecord(fact.metadata);
      const origin = originFromMetadata(metadata);
      const hash = normalizeText(metadata.pricing_source_hash) || sha256(JSON.stringify(fact));
      registerValueOrigin(byValue, fact.claim_text, origin, hash);
      for (const value of [...(fact.qualifiers || []), ...(fact.boundary_notes || []), ...(fact.next_steps || [])]) {
        registerValueOrigin(byValue, value, origin, hash);
      }
    }
  }
  for (const cards of Object.values(input.cardResultsByCoverageItem)) {
    for (const card of cards) {
      const metadata = asRecord(card.metadata);
      const origin = originFromMetadata(metadata);
      const hash = normalizeText(metadata.pricing_source_hash) || sha256(JSON.stringify(card));
      for (const value of [card.canonical_name, card.summary, card.support_summary]) {
        registerValueOrigin(byValue, value, origin, hash);
      }
    }
  }
  const setPath = (path: string, value: unknown, fallbackOrigin: PricingPacketOrigin, forceFallback = false) => {
    const text = normalizeText(value);
    if (!text) return;
    provenance[path] = (!forceFallback && byValue.get(text.toLowerCase())) || {
      origin: fallbackOrigin,
      source_hash: sha256(text)
    };
  };
  setPath("/query_text", input.packet.query_text, "caller", true);
  input.packet.coverage.forEach((coverage, coverageIndex) => {
    const coverageOrigin = input.coverageItemOrigins.get(coverage.requested_coverage_item_text) || "caller";
    setPath(`/coverage/${coverageIndex}/requested_coverage_item_text`, coverage.requested_coverage_item_text, coverageOrigin, true);
    for (const field of ["direct_answer_points", "qualifiers", "limits_or_exclusions", "next_step_options"] as const) {
      coverage[field].forEach((value, index) => setPath(`/coverage/${coverageIndex}/${field}/${index}`, value, "website_or_upload"));
    }
  });
  for (const field of ["direct_answer_points", "qualifiers", "limits_or_exclusions", "next_step_options"] as const) {
    input.packet[field].forEach((value, index) => setPath(`/${field}/${index}`, value, "website_or_upload"));
  }
  input.packet.unsupported_requested_items.forEach((value, index) => {
    setPath(`/unsupported_requested_items/${index}`, value, input.coverageItemOrigins.get(value) || "caller", true);
  });
  return provenance;
}

function valueAtPath(value: unknown, path: string) {
  const segments = path.split("/").slice(1).map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: any = value;
  for (const segment of segments) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
}

function estimateTokenCount(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

export function createSafePricingFallbackPacket(packet: DeterministicAnswerPacket): DeterministicAnswerPacket {
  const base = {
    answer_packet_id: packet.answer_packet_id,
    tenant_id: packet.tenant_id,
    build_id: packet.build_id,
    query_text: packet.query_text,
    runtime_mode: "answer" as const,
    coverage: [{
      requested_coverage_item_text: "pricing question",
      support_strength: "partial" as const,
      used_card_ids: [],
      used_fact_ids: [],
      direct_answer_points: [GENERIC_PRICE_FREE_RESTATEMENT],
      qualifiers: [],
      limits_or_exclusions: [],
      next_step_options: []
    }],
    direct_answer_points: [GENERIC_PRICE_FREE_RESTATEMENT],
    qualifiers: [],
    limits_or_exclusions: [],
    next_step_options: [],
    unsupported_requested_items: [],
    used_card_ids: [],
    used_fact_ids: [],
    metadata: {
      ...asRecord(packet.metadata),
      pricing_safety_fallback: true
    }
  };
  return deterministicAnswerPacketSchema.parse({
    ...base,
    token_counts: {
      packet_tokens: estimateTokenCount(base),
      soft_budget_tokens: packet.token_counts.soft_budget_tokens,
      hard_budget_tokens: packet.token_counts.hard_budget_tokens
    }
  });
}

export function enforcePricingSafetyBoundary(input: {
  packet: DeterministicAnswerPacket;
  provenance: PacketProvenanceByPath;
  logContext?: Record<string, unknown>;
}) {
  const inspectedOrigins = new Set<PricingPacketOrigin>([
    "planner_generated",
    "website_or_upload",
    "tenant_unapproved"
  ]);
  const hit = Object.entries(input.provenance).find(([path, entry]) =>
    inspectedOrigins.has(entry.origin) && containsMonetaryOrRateExpression(valueAtPath(input.packet, path))
  );
  if (!hit) return { packet: input.packet, replaced: false, hit: null };
  const [fieldPath, entry] = hit;
  console.error("pricing_safety_boundary_replaced_packet", {
    ...(input.logContext || {}),
    fieldPath,
    sourceHash: entry.source_hash,
    origin: entry.origin
  });
  return {
    packet: createSafePricingFallbackPacket(input.packet),
    replaced: true,
    hit: { fieldPath, ...entry }
  };
}
