import crypto from "node:crypto";
import {
  domainPackDefinitions,
  getPackDefinitionsVersion,
  subdomainPackDefinitions
} from "../../../config/knowledge-receptionist/packs/v1/index.js";

const PACK_SOURCE_PATH = "config/knowledge-receptionist/packs/v1/index.js";

const INDUSTRY_TO_ASSIGNMENT = {
  plumbing: [{ domainId: "service_business", subdomainId: "service_business.plumbing" }],
  hvac: [{ domainId: "service_business", subdomainId: "service_business.hvac" }],
  electrical: [{ domainId: "service_business", subdomainId: "service_business.electrical" }],
  roofing: [{ domainId: "service_business", subdomainId: "service_business.roofing" }],
  window_installers: [{ domainId: "service_business", subdomainId: "service_business.window_installation" }],
  landscaping: [{ domainId: "service_business", subdomainId: "service_business.landscaping" }],
  cleaning: [{ domainId: "service_business", subdomainId: "service_business.cleaning" }],
  pest_control: [{ domainId: "service_business", subdomainId: "service_business.pest_control" }],
  garage_door: [{ domainId: "service_business", subdomainId: "service_business.garage_door" }],
  general_contractor: [{ domainId: "service_business", subdomainId: "service_business.general_contracting" }],
  locksmith: [{ domainId: "service_business", subdomainId: "service_business.locksmith" }]
};

function normalizeText(value) {
  return String(value || "").trim();
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalSourcePath(kind, packId) {
  return `${PACK_SOURCE_PATH}#${kind}:${packId}`;
}

async function withTransaction(db, work) {
  const canBorrowClient = typeof db?.connect === "function" && typeof db?.release !== "function";
  if (!canBorrowClient) {
    return work(db);
  }
  const client = await db.connect();
  await client.query("BEGIN");
  try {
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function uniqueAssignments(assignments) {
  const seen = new Set();
  const output = [];
  for (const item of assignments || []) {
    const domainId = normalizeText(item?.domainId || item?.domain_id);
    const subdomainId = normalizeText(item?.subdomainId || item?.subdomain_id);
    if (!domainId || !subdomainId) continue;
    const key = `${domainId}::${subdomainId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ domainId, subdomainId });
  }
  return output;
}

export function inferKnowledgeAssignmentsForIndustry(industry) {
  return uniqueAssignments(INDUSTRY_TO_ASSIGNMENT[normalizeText(industry)] || []);
}

export async function syncCanonicalKnowledgePacks(db) {
  const version = getPackDefinitionsVersion();
  let domainInserted = 0;
  let domainUpdated = 0;
  let subdomainInserted = 0;
  let subdomainUpdated = 0;

  for (const pack of domainPackDefinitions) {
    const sourceHash = stableHash({ version, pack });
    const existing = await db.query(
      `SELECT source_hash
       FROM domain_packs
       WHERE domain_id = $1
       LIMIT 1`,
      [pack.domain_id]
    );
    const params = [
      pack.domain_id,
      pack.name,
      pack.version,
      pack.status,
      pack.description,
      JSON.stringify(pack.naics_codes || []),
      JSON.stringify(pack.intent_catalog || []),
      JSON.stringify(pack.entity_catalog || []),
      JSON.stringify(pack.page_type_weights || {}),
      JSON.stringify(pack.content_class_biases || {}),
      JSON.stringify(pack.ranking_rules || []),
      JSON.stringify(pack.boundary_rules || []),
      JSON.stringify(pack.clarification_rules || []),
      JSON.stringify(pack.default_stage_guidance || []),
      JSON.stringify(pack.default_prompt_fragments || []),
      JSON.stringify(pack.required_eval_suites || []),
      canonicalSourcePath("domain", pack.domain_id),
      sourceHash
    ];

    if (!existing.rowCount) {
      await db.query(
        `INSERT INTO domain_packs (
           domain_id, name, version, status, description, naics_codes_json, intent_catalog_json,
           entity_catalog_json, page_type_weights_json, content_class_biases_json, ranking_rules_json,
           boundary_rules_json, clarification_rules_json, default_stage_guidance_json,
           default_prompt_fragments_json, required_eval_suites_json, source_path, source_hash
         )
         VALUES (
           $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
           $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18
         )`,
        params
      );
      domainInserted += 1;
      continue;
    }

    if (String(existing.rows[0]?.source_hash || "") === sourceHash) continue;
    await db.query(
      `UPDATE domain_packs
       SET name = $2,
           version = $3,
           status = $4,
           description = $5,
           naics_codes_json = $6::jsonb,
           intent_catalog_json = $7::jsonb,
           entity_catalog_json = $8::jsonb,
           page_type_weights_json = $9::jsonb,
           content_class_biases_json = $10::jsonb,
           ranking_rules_json = $11::jsonb,
           boundary_rules_json = $12::jsonb,
           clarification_rules_json = $13::jsonb,
           default_stage_guidance_json = $14::jsonb,
           default_prompt_fragments_json = $15::jsonb,
           required_eval_suites_json = $16::jsonb,
           source_path = $17,
           source_hash = $18,
           updated_at = NOW()
       WHERE domain_id = $1`,
      params
    );
    domainUpdated += 1;
  }

  for (const pack of subdomainPackDefinitions) {
    const sourceHash = stableHash({ version, pack });
    const existing = await db.query(
      `SELECT source_hash
       FROM subdomain_packs
       WHERE subdomain_id = $1
       LIMIT 1`,
      [pack.subdomain_id]
    );
    const params = [
      pack.subdomain_id,
      pack.parent_domain_id,
      pack.name,
      pack.version,
      pack.status,
      pack.description,
      JSON.stringify(pack.additional_intents || []),
      JSON.stringify(pack.additional_entities || []),
      JSON.stringify(pack.page_type_weight_deltas || {}),
      JSON.stringify(pack.content_class_bias_deltas || {}),
      JSON.stringify(pack.ranking_rule_deltas || []),
      JSON.stringify(pack.boundary_rule_deltas || []),
      JSON.stringify(pack.clarification_rule_deltas || []),
      JSON.stringify(pack.stage_guidance_deltas || []),
      JSON.stringify(pack.prompt_fragment_deltas || []),
      JSON.stringify(pack.required_eval_suites || []),
      canonicalSourcePath("subdomain", pack.subdomain_id),
      sourceHash
    ];

    if (!existing.rowCount) {
      await db.query(
        `INSERT INTO subdomain_packs (
           subdomain_id, parent_domain_id, name, version, status, description,
           additional_intents_json, additional_entities_json, page_type_weight_deltas_json,
           content_class_bias_deltas_json, ranking_rule_deltas_json, boundary_rule_deltas_json,
           clarification_rule_deltas_json, stage_guidance_deltas_json, prompt_fragment_deltas_json,
           required_eval_suites_json, source_path, source_hash
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
           $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18
         )`,
        params
      );
      subdomainInserted += 1;
      continue;
    }

    if (String(existing.rows[0]?.source_hash || "") === sourceHash) continue;
    await db.query(
      `UPDATE subdomain_packs
       SET parent_domain_id = $2,
           name = $3,
           version = $4,
           status = $5,
           description = $6,
           additional_intents_json = $7::jsonb,
           additional_entities_json = $8::jsonb,
           page_type_weight_deltas_json = $9::jsonb,
           content_class_bias_deltas_json = $10::jsonb,
           ranking_rule_deltas_json = $11::jsonb,
           boundary_rule_deltas_json = $12::jsonb,
           clarification_rule_deltas_json = $13::jsonb,
           stage_guidance_deltas_json = $14::jsonb,
           prompt_fragment_deltas_json = $15::jsonb,
           required_eval_suites_json = $16::jsonb,
           source_path = $17,
           source_hash = $18,
           updated_at = NOW()
       WHERE subdomain_id = $1`,
      params
    );
    subdomainUpdated += 1;
  }

  return {
    version,
    domainInserted,
    domainUpdated,
    subdomainInserted,
    subdomainUpdated
  };
}

export async function loadTenantDomainAssignments(db, tenantKey) {
  const res = await db.query(
    `SELECT domain_id, subdomain_id
     FROM tenant_domain_assignments
     WHERE tenant_key = $1
       AND status = 'active'
     ORDER BY updated_at DESC, id DESC`,
    [tenantKey]
  );
  return uniqueAssignments(res.rows || []);
}

export async function resolveTenantDomainAssignments(db, tenantKey, requestedAssignments = []) {
  const normalizedRequested = uniqueAssignments(requestedAssignments);
  if (normalizedRequested.length) {
    return withTransaction(db, async (client) => {
      await client.query(`DELETE FROM tenant_domain_assignments WHERE tenant_key = $1`, [tenantKey]);
      for (const item of normalizedRequested) {
        await client.query(
          `INSERT INTO tenant_domain_assignments (tenant_key, domain_id, subdomain_id, status)
           VALUES ($1, $2, $3, 'active')`,
          [tenantKey, item.domainId, item.subdomainId]
        );
      }
      return normalizedRequested;
    });
  }

  const existingAssignments = await loadTenantDomainAssignments(db, tenantKey);
  if (existingAssignments.length) return existingAssignments;

  const tenantRes = await db.query(
    `SELECT industry
     FROM tenants
     WHERE tenant_key = $1
     LIMIT 1`,
    [tenantKey]
  );
  const industry = normalizeText(tenantRes.rows[0]?.industry);
  const inferredAssignments = inferKnowledgeAssignmentsForIndustry(industry);
  if (inferredAssignments.length) {
    await withTransaction(db, async (client) => {
      for (const item of inferredAssignments) {
        await client.query(
          `INSERT INTO tenant_domain_assignments (tenant_key, domain_id, subdomain_id, status)
           VALUES ($1, $2, $3, 'active')
           ON CONFLICT (tenant_key, domain_id, subdomain_id)
           DO UPDATE SET status = 'active',
                         updated_at = NOW()`,
          [tenantKey, item.domainId, item.subdomainId]
        );
      }
    });
  }
  return inferredAssignments;
}
