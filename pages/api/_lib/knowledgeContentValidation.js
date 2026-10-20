// Frozen REQ-PIPE-010/013/015 and REQ-RULE-004/009: deterministic,
// evidence-preserving normalization and conflict review, before runtime indexing.
import { sourcePrecedenceScoreFromMetadata } from '../../../packages/contracts/dist/knowledgeSourcePrecedence.js';
const text = (v) => String(v || '').trim();
const key = (v) => text(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const unique = (v) => [...new Set(v)];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const UNIVERSAL_OBJECT_TYPES = ['organization', 'offering', 'offering_family', 'policy', 'process', 'location', 'hours', 'person', 'faq', 'boundary', 'promotion', 'trust_signal', 'contact_channel', 'service_area'];

export function selectKnowledgeEvidence(claim, chunks, chunkIds = []) {
  const allowed = new Set(chunkIds);
  const spans = chunks.filter(c => allowed.has(c.source_chunk_id)).map(c => text(c.text_span || c.text));
  const exact = spans.find(span => span.includes(text(claim)));
  if (exact) return text(claim);
  const tokens = new Set(key(claim).split(' ').filter(w => w.length > 3));
  const lines = spans.flatMap(span => span.split(/\n+/)).filter(Boolean);
  lines.sort((a,b) => key(b).split(' ').filter(w => tokens.has(w)).length - key(a).split(' ').filter(w => tokens.has(w)).length);
  return (lines[0] || '').slice(0, 1200);
}

export function normalizeKnowledgeClaim(fact) {
  const claim = text(fact.claim_text || fact.object_text);
  const topic = text(fact.subtopic_name || fact.topic_name || fact.subject);
  const label = `${topic} ${fact.fact_role || ''}`.toLowerCase();
  const lower = claim.toLowerCase();
  let type = 'faq';
  let factType = 'answer';
  let value = { text: claim };
  let identity = key(topic);
  const money = [...claim.matchAll(/(?:\$|USD\s*)(\d[\d,]*(?:\.\d{1,2})?)/gi)].map(m => Number(m[1].replaceAll(',', '')));
  const phone = claim.match(/(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  const email = claim.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const negative = /\b(?:not|never|no longer|do not|does not|don't|doesn't|unavailable|excluded|exclude|cannot)\b/.test(lower);
  if (money.length || /\b(?:price|pricing|cost|fee)\b/.test(label)) {
    type = 'policy'; factType = 'price';
    value = { text: claim, amounts: money, ...(money.length ? { currency: /USD/i.test(claim) ? 'USD' : null, currency_symbol: /\$/.test(claim) ? '$' : null } : {}), qualifier: /\b(?:from|starting|as low as)\b/i.test(claim) ? 'starting_at' : /\b(?:up to|maximum)\b/i.test(claim) ? 'maximum' : 'stated', tenant_price_authorization: false };
  } else if (phone || email) {
    type = 'contact_channel'; factType = email ? 'email' : 'phone';
    value = { text: claim, channel: factType, value: email ? email[0].toLowerCase() : phone[0].replace(/[^\d+]/g, '') };
    const purpose = /\bfax\b/i.test(claim) ? 'fax' : /\b(?:emergency|urgent)\b/i.test(claim) ? 'emergency' : /after.hours/i.test(claim) ? 'after hours' : 'main';
    identity = `${factType}:${purpose}`;
  } else if (/\b(?:hours|open|closed)\b/.test(label + ' ' + lower) && /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|daily|24\/7|hours)\b/.test(lower)) {
    type = 'hours'; factType = 'hours';
    let days = DAYS.filter(d => new RegExp(`\\b${d}(?:s)?\\b|\\b${d.slice(0,3)}\\b`, 'i').test(claim));
    const range = lower.match(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*(?:to|through|[-–—])\s*(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/);
    if (range) {
      const first = DAYS.findIndex(d => d.startsWith(range[1].slice(0,3)));
      const last = DAYS.findIndex(d => d.startsWith(range[2].slice(0,3)));
      days = Array.from({ length: (last-first+7)%7+1 }, (_, i) => DAYS[(first+i)%7]);
    }
    if (/\b(?:daily|every day)\b/.test(lower)) days = [...DAYS];
    value = { text: claim, days, times: [...claim.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi)].map(m => m[0].replace(/\s/g, '').toLowerCase()), always_open: /24\s*\/\s*7/.test(claim), closed: /\bclosed\b/.test(lower) };
    // Office hours and after-hours phone answering are distinct claims.
    identity = /\b(?:phone|answer|telephone)\b/.test(lower + ' ' + label) ? 'phone hours' : 'office hours';
    // Day overlap is resolved independently; 24/7 must conflict with a narrower schedule.
  } else if (/service area|coverage|cities|areas served|where.*serve/.test(label) || /\b(?:serves?|serving|service area|coverage includes|coverage excludes)\s+/.test(lower)) {
    type = 'service_area'; factType = 'service_area';
    const match = claim.match(/(?:serves?|serving|service area(?:\s+(?:includes|covers|is))?|coverage (?:includes|excludes))\s+(.+?)[.!]?$/i);
    const areas = match ? match[1].replace(/[.!]$/, '').split(/,|\s+and\s+/i).map(text).filter(Boolean) : [];
    value = { text: claim, areas, included: !negative };
    // Different named cities are additive; opposite claims about the same city conflict.
    identity = areas.length ? key(areas.slice().sort().join('|')) : key(topic);
  } else if (/address|location/.test(label) || /\b(?:located at|address is)\b/.test(lower)) {
    type = 'location'; factType = 'address';
  } else if (/emergency|urgent|safety|boundary|exclusion/.test(label)) {
    type = 'boundary'; factType = 'boundary'; value = { text: claim, permitted: !negative };
  } else if (/policy|insurance|referral|warranty|cancellation|eligib|require/.test(label + ' ' + lower)) {
    type = 'policy'; factType = 'policy'; value = { text: claim, permitted: !negative, required: /\b(?:required|requires|must)\b/.test(lower) };
  } else if (/process|next_step|schedule|booking|how to/.test(label)) {
    type = 'process'; factType = 'process_step';
  } else if (/person|provider|staff|team/.test(label)) {
    type = 'person'; factType = 'person_detail';
  } else if (/promotion|special offer|discount/.test(label)) {
    type = 'promotion'; factType = 'promotion';
  } else if (/award|accredit|certif|trust/.test(label)) {
    type = 'trust_signal'; factType = 'credential';
  } else if (/family|category/.test(label)) {
    type = 'offering_family'; factType = 'offering_group';
  } else if (/service|offering|repair|install|capability|treatment/.test(label)) {
    type = 'offering'; factType = 'offering_availability'; value = { text: claim, available: !negative };
  } else if (/business|company|organization|name/.test(label)) {
    type = 'organization'; factType = 'organization_detail';
  }
  const scope = fact.scope_json || fact.scope || {};
  const scopeKey = [scope.location_id, scope.provider_id, scope.offering_id, scope.domain_id, scope.subdomain_id, ...(fact.qualifiers || [])].map(key).join('|');
  return { fact_type: factType, object_type: type, normalized_value_json: value,
    predicate: factType, semantic_key: `${factType}:${identity}:${scopeKey}` };
}

function precedence(fact) {
  const meta = fact.scope_json || {};
  let score = sourcePrecedenceScoreFromMetadata(meta) * 1000;
  const page = key(meta.page_type);
  const question = fact.fact_type;
  if (['hours', 'phone', 'email', 'address'].includes(question) && /contact|location|hours/.test(page)) score += 8;
  else if (['policy', 'price', 'boundary'].includes(question) && /policy|faq/.test(page)) score += 8;
  else if (question === 'service_area' && /service area/.test(page)) score += 8;
  else if (question === 'offering_availability' && /service detail/.test(page)) score += 8;
  if (meta.explicit === true) score += 1;
  return score;
}
function conflictValue(fact) {
  const v = fact.normalized_value_json || {};
  if (fact.fact_type === 'service_area') return String(v.included);
  if (fact.fact_type === 'offering_availability') return String(v.available);
  if (['phone', 'email'].includes(fact.fact_type)) return v.value;
  // A prose policy cannot be compared by a boolean alone: distinct conditions matter.
  if (fact.fact_type === 'price' && v.amounts?.length) return JSON.stringify([v.amounts, v.qualifier, v.currency, v.currency_symbol]);
  if (fact.fact_type === 'hours' && (v.times?.length >= 2 || v.closed || v.always_open)) return JSON.stringify([v.times, v.closed, v.always_open]);
  return key(v.text);
}

export function resolveKnowledgeConflicts(facts, cards) {
  const groups = new Map();
  const excluded = new Set();
  const groupsByFact = new Map();
  const excludedGroupsByFact = new Map();
  const conflicts = [];
  for (const fact of facts) {
    if (!['hours', 'phone', 'email', 'address', 'price', 'service_area', 'policy', 'boundary', 'offering_availability'].includes(fact.fact_type)) continue;
    const k = `${fact.domain_id}:${fact.subdomain_id || ''}:${fact.support_metadata_json?.semantic_key || fact.fact_type + ':' + key(fact.subject)}`;
    const areaKeys = fact.fact_type === 'service_area' && fact.normalized_value_json?.areas?.length
      ? fact.normalized_value_json.areas.map(area => `${fact.domain_id}:${fact.subdomain_id || ''}:service_area:${key(area)}:${fact.scope_json?.location_id || ''}`)
      : fact.fact_type === 'hours'
        ? (fact.normalized_value_json.days?.length ? fact.normalized_value_json.days : DAYS).map(day => `${k}:${day}`)
        : [k];
    groupsByFact.set(fact.knowledge_fact_id, new Set(areaKeys));
    for (const groupKey of areaKeys) groups.set(groupKey, [...(groups.get(groupKey) || []), fact]);
  }
  for (const [semanticKey, rows] of groups) {
    if (unique(rows.map(conflictValue)).length < 2) continue;
    const sorted = [...rows].sort((a, b) => precedence(b) - precedence(a) || text(a.knowledge_fact_id).localeCompare(text(b.knowledge_fact_id)));
    const top = sorted.filter(f => precedence(f) === precedence(sorted[0]));
    const resolved = unique(top.map(conflictValue)).length === 1;
    const winningValue = conflictValue(sorted[0]);
    for (const f of rows) if (!resolved || conflictValue(f) !== winningValue) {
      excluded.add(f.knowledge_fact_id);
      const excludedGroups = excludedGroupsByFact.get(f.knowledge_fact_id) || new Set();
      excludedGroups.add(semanticKey);
      excludedGroupsByFact.set(f.knowledge_fact_id, excludedGroups);
    }
    conflicts.push({ semantic_key: semanticKey, severity: ['phone', 'email', 'boundary', 'address'].includes(rows[0].fact_type) ? 'critical' : 'high',
      resolution: resolved ? 'source_precedence' : 'unresolved',
      winner_fact_ids: resolved ? rows.filter(f => !excluded.has(f.knowledge_fact_id)).map(f => f.knowledge_fact_id) : [],
      evidence: rows.map(f => ({ fact_id: f.knowledge_fact_id, claim: f.claim_text, source_ref_ids: f.source_ref_ids_json, evidence_text: f.evidence_text, authority: f.scope_json?.source_authority, page_type: f.scope_json?.page_type })) });
  }
  // A source claim may cover several days or cities. Removing that entire
  // claim for a one-day/city disagreement would silently discard other truth.
  // Until atomically supported replacements exist, quarantine it and block
  // publication instead of claiming the partial resolution is complete.
  for (const conflict of conflicts) {
    const partialIds = conflict.evidence.map(row => row.fact_id).filter(id =>
      excludedGroupsByFact.has(id) && excludedGroupsByFact.get(id).size < groupsByFact.get(id).size);
    if (partialIds.length) {
      conflict.resolution = 'unresolved';
      conflict.reason = 'partial_claim_conflict_requires_atomic_review';
      conflict.partial_claim_fact_ids = partialIds;
      conflict.winner_fact_ids = [];
    }
  }
  const surviving = facts.filter(f => !excluded.has(f.knowledge_fact_id));
  const byId = new Map(surviving.map(f => [f.knowledge_fact_id, f]));
  const survivingCards = cards.flatMap(card => {
    const ids = card.support_metadata_json?.fact_ids || card.answer_facts_json?.map(f => f.fact_id) || [];
    const kept = ids.map(id => byId.get(id)).filter(Boolean);
    if (!kept.length) return [];
    const changed = ids.some(id => excluded.has(id));
    return [{ ...card, object_type: kept[0].object_type, quality_score: Math.min(...kept.map(f => Number(f.confidence) || 0)),
      ...(changed ? {
        canonical_name: kept[0].subject || 'Verified information',
        speakable_summary: kept.map(f => f.claim_text).join(' '),
        support_summary: kept.map(f => f.claim_text).join(' '),
        search_text: kept.map(f => f.claim_text).join(' '),
        aliases_json: [], caller_phrases_json: [], entity_tags_json: []
      } : {}),
      answer_facts_json: kept.map(f => ({ fact_id: f.knowledge_fact_id, claim: f.claim_text, fact_role: f.fact_role })),
      source_ref_ids_json: unique(kept.flatMap(f => f.source_ref_ids_json || [])),
      support_metadata_json: { ...card.support_metadata_json, fact_ids: kept.map(f => f.knowledge_fact_id) } }];
  });
  return { facts: surviving, cards: survivingCards, conflicts };
}

export function analyzeKnowledgeContent({ buildInfo, facts, cards, sources, conflicts = [], previousFacts = [], previousBuildId = null }) {
  const blockers = [], warnings = [];
  const sourceIds = new Set(sources.map(s => s.sourceRefId || s.source_ref_id));
  const sourceById = new Map(sources.map(s => [s.sourceRefId || s.source_ref_id, s]));
  const assignments = buildInfo.domain_assignments_json || [{ domain_id: buildInfo.primaryDomainId, subdomain_id: buildInfo.primarySubdomainId }];
  for (const fact of facts) {
    if (fact.tenant_key !== buildInfo.tenant_key || fact.build_id !== buildInfo.build_id) blockers.push('artifact_tenant_build_mismatch');
    if (!assignments.some(a => (a.domain_id || a.domainId) === fact.domain_id && (!(a.subdomain_id || a.subdomainId) || (a.subdomain_id || a.subdomainId) === fact.subdomain_id))) blockers.push('artifact_domain_mismatch');
    if (!UNIVERSAL_OBJECT_TYPES.includes(fact.object_type) || !fact.normalized_value_json || !text(fact.claim_text)) blockers.push('fact_schema_invalid');
    if (!fact.source_span_refs_json?.length || !text(fact.evidence_text)) blockers.push('fact_source_span_missing');
    if (!fact.source_ref_ids_json?.length || fact.source_ref_ids_json.some(id => !sourceIds.has(id))) blockers.push('fact_evidence_missing');
    // Model paraphrases are allowed. Numerical facts must still have their numbers in captured evidence.
    const numeric = [...text(fact.claim_text).matchAll(/\d+(?:[.,:]\d+)*/g)].map(m => m[0]);
    const evidence = (fact.source_ref_ids_json || []).map(id => sourceById.get(id)).filter(Boolean).flatMap(s => (s.sourceChunks || []).map(c => c.text || c.text_span || c.chunk_text || '')).join(' ');
    if (numeric.length && evidence && numeric.some(n => !evidence.includes(n))) warnings.push('numeric_claim_requires_review');
    if (fact.scope_json?.source_authority === 'owner_interview_unconfirmed') blockers.push('interview_confirmation_required');
    if (fact.scope_json?.source_authority === 'uploaded_unclassified_pending_review') warnings.push('uploaded_authority_classification_pending');
    if (Number(fact.confidence) < 0.65) warnings.push('low_confidence_facts');
  }
  if (!facts.length || !cards.length) blockers.push('no_viable_runtime_knowledge');
  for (const c of conflicts) if (c.resolution === 'unresolved') blockers.push(`unresolved_${c.severity}_conflict`);
  const types = new Set(facts.map(f => f.object_type));
  for (const t of ['hours', 'location', 'contact_channel']) if (!types.has(t)) warnings.push(`operational_coverage_missing:${t}`);
  if (!types.has('offering') && !types.has('policy')) warnings.push('likely_unanswered_service_questions');
  if (sources.length === 0) blockers.push('approved_source_coverage_missing');
  const previousClaims = new Set(previousFacts.map(f => key(f.claim_text)));
  const currentClaims = new Set(facts.map(f => key(f.claim_text)));
  const added = facts.filter(f => !previousClaims.has(key(f.claim_text))).map(f => f.claim_text);
  const removed = previousFacts.filter(f => !currentClaims.has(key(f.claim_text))).map(f => f.claim_text);
  return { diff: { previous_build_id: previousBuildId, added_count: added.length, removed_count: removed.length, added_claims: added, removed_claims: removed, added_sample: added.slice(0, 50), removed_sample: removed.slice(0, 50) }, version: 'content_qa_v1', blockers: unique(blockers), warnings: unique(warnings), conflicts,
    fact_count: facts.length, card_count: cards.length, covered_object_types: [...types].sort(), recommendation: blockers.length ? 'blocked' : 'review',
    evidence_scope: 'Deterministic schema, provenance, normalization and same-key contradiction checks; human content and runtime checks required.' };
}
