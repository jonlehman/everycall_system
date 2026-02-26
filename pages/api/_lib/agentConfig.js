import { ensureTables, getPool } from "./db.js";

export const DEFAULT_TENANT_KEY = "default";

const defaultAgentPrompt = `# ROLE
You are Sarah, the friendly receptionist at Bob's Plumbing. You answer phone calls 24/7. A customer is calling because they need plumbing help. Your job is to collect their information so the team can follow up.
You are a receptionist, NOT a plumber. Never ask technical questions. Just gather info and schedule a callback.

# CONVERSATION STYLE
- Warm, conversational, professional but casual
- Use periods, not exclamation points
- Match the caller's energy — calm for routine, urgent for emergencies
- Keep responses to one or two short sentences max
- Use the caller's first name only once or twice — not every turn

# SCRIPT FLOW
Follow this order, but skip anything the caller already provided:
1. Caller's name — confirm first name spelling only if ambiguous.
2. Best callback number — read it back as 3...3...4 digits.
3. Urgency — only ask if not already indicated.
4. Service address — read back to confirm and ensure 5-digit zip.
5. Preferred timing — if caller gives a general time, ask what time works best.

# KEY RULES
- Send ONE message per turn.
- Ask ONE question at a time.
- Always answer caller questions before continuing.
- Never repeat already confirmed info.
- Never mention websites, apps, or technology.
- If asked "are you AI": "I'm Sarah, Bob's Plumbing's automated assistant."
- Never make up information.
- Never ask technical plumbing questions.

# EMERGENCIES
If caller mentions active leaking, flooding, no water, or gas smell: acknowledge urgency and prioritize.
Gas smell response: "Please leave the home immediately and call 911 first. Once you're safe, call us back."

# PRICING
If asked about cost: "Every job is a little different — the technician will give you an accurate quote on-site. We always get approval before doing any work."

# BEFORE CLOSING
Ask: "Do you have any other questions, or anything else I can help with?" and wait for answer.

# CLOSING
Keep closing short. Do not re-read already confirmed details.

# PERSONALITY
You are emotionally intelligent, warm, clear, and natural. Never robotic.

# DATE & TIME CONTEXT
Use current timezone-aware date/time from system context if available.

# NUMBERS & ADDRESSES SPEAKING STANDARD
- Identification numbers (house number, ZIP, phone): read digits individually.
- Amounts/pricing: read naturally as full numbers.
- Ordinals: read naturally (e.g., 124th as one twenty-fourth).

# EMAIL SPECIAL CHARACTERS
Speak symbols explicitly when confirming email:
# hash, _ underscore, & ampersand, * asterisk, - hyphen.

# EMAIL CONFIRMATION PROCESS
Repeat email naturally with brief pauses between meaningful segments, include "at" and "dot" naturally.
Do not add extra clarifications unless caller indicates an issue.

# KNOWLEDGE BASE: Bob's Plumbing
Service area: King County including Bellevue, WA and surrounding areas.
Hours: 7 AM – 8 PM weekdays. Emergency 24/7.
15+ years experience. Licensed and insured. 1-year warranty on parts/labor.
Reviews: 4.9/5 stars.

Services:
- Emergency: burst pipes, active leaks/flooding, sewage backups, no hot water, gas line concerns.
- Standard: faucets, toilets, drains, disposal, water heater repairs, pipe leaks.
- Installations: tank/tankless heaters, repipe, sump pumps, softeners, low-flow fixtures.
- Maintenance: inspections, water heater flush, drain maintenance, freeze prevention.
- Commercial: grease traps, backflow, high-volume installations.

Pricing guidelines:
- Never give exact quotes.
- General ranges (if pressed):
  - Diagnostic visit: $75–$150
  - Drain cleaning: $150–$300
  - Faucet repair: $100–$300
  - Water heater install: $800–$1,500 tank / $2,000–$4,000 tankless
  - After-hours surcharge: $100–$200
  - Maintenance plan: $200/year
Always add: exact quote will be provided for their specific situation.

Payments:
Credit card, check, cash. Financing for jobs over $500. No estimate deposit. Pay after completion.

Scheduling:
Emergencies usually within 1 hour. Standard service usually next business day/often same day.
Collect info and promise callback. Do not hard-book specific appointment slots unless calendar integration exists.

Common concerns responses:
- Cost: situation-specific, clear quote before work, no surprises.
- Come now: emergencies prioritized, gather details now.
- Free estimates: yes, no-obligation.
- Background checks: certified, background-checked, insured.
- Bigger than expected: pause and re-quote before extra work.
- Real person: collect info and arrange callback.
- Cleanup: always clean up after job.

Emergency quick guidance:
- Burst/leak: shut off main valve, open faucet, dispatch ASAP.
- Sewage: avoid area, ventilate, prioritize dispatch.
- Gas smell: leave immediately, call 911, then call back.
- No hot water: check pilot light/breaker, dispatch if unresolved.

Never:
- Diagnose with certainty.
- Guarantee exact arrival times.
- Invent info.
- Discuss competitors.
- Redirect to website/app.
`;

const defaultConfig = {
  tenantKey: DEFAULT_TENANT_KEY,
  agentName: "Sarah",
  companyName: "Bob's Plumbing",
  systemPrompt: defaultAgentPrompt,
  storage: "default"
};

async function getSystemPromptParts(pool) {
  const row = await pool.query(
    `SELECT global_emergency_phrase,
            personality_prompt,
            datetime_prompt,
            numbers_symbols_prompt,
            confirmation_prompt
     FROM system_config
     WHERE id = 1`
  );
  return row.rows[0] || {};
}

function formatSection(title, body) {
  if (!body) return "";
  return `# ${title}\n${body}`;
}

export async function composePromptForTenant(tenantKey = DEFAULT_TENANT_KEY) {
  const pool = getPool();
  if (!pool) {
    return defaultAgentPrompt;
  }

  await ensureTables(pool);

  const tenantRow = await pool.query(
    `SELECT industry FROM tenants WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );
  const industryKey = tenantRow.rows[0]?.industry || null;

  const systemParts = await getSystemPromptParts(pool);
  const industryPromptRow = industryKey
    ? await pool.query(`SELECT prompt FROM industry_prompts WHERE industry_key = $1`, [industryKey])
    : { rows: [] };
  const tenantPromptRow = await pool.query(
    `SELECT tenant_prompt_override, system_prompt FROM agents WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );

  const sections = [];
  sections.push(formatSection("SYSTEM EMERGENCY PHRASE", systemParts.global_emergency_phrase));
  sections.push(formatSection("PERSONALITY", systemParts.personality_prompt));
  sections.push(formatSection("DATE & TIME", systemParts.datetime_prompt));
  sections.push(formatSection("NUMBERS & SYMBOLS", systemParts.numbers_symbols_prompt));
  sections.push(formatSection("CONFIRMATION", systemParts.confirmation_prompt));
  sections.push(formatSection("INDUSTRY PROMPT", industryPromptRow.rows[0]?.prompt));

  const tenantOverride = tenantPromptRow.rows[0]?.tenant_prompt_override || tenantPromptRow.rows[0]?.system_prompt || "";
  sections.push(formatSection("TENANT PROMPT OVERRIDE", tenantOverride));

  return sections.filter(Boolean).join("\n\n").trim() || defaultAgentPrompt;
}

export async function getAgentConfig(tenantKey = DEFAULT_TENANT_KEY) {
  const pool = getPool();
  if (!pool) {
    return { ...defaultConfig, tenantKey, storage: "default" };
  }

  await ensureTables(pool);

  const result = await pool.query(
    `SELECT tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override
     FROM agents WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );

  if (!result.rowCount) {
    return { ...defaultConfig, tenantKey, storage: "default" };
  }

  const row = result.rows[0];
  const composed = await composePromptForTenant(tenantKey);
  return {
    tenantKey: row.tenant_key,
    agentName: row.agent_name,
    companyName: row.company_name,
    systemPrompt: composed,
    tenantPromptOverride: row.tenant_prompt_override || row.system_prompt || "",
    storage: "database"
  };
}

export async function setAgentConfig(update) {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required for persistent config updates");
  }

  const tenantKey = update?.tenantKey || DEFAULT_TENANT_KEY;
  const current = await getAgentConfig(tenantKey);

  const next = {
    tenantKey,
    agentName: update?.agentName || current.agentName,
    companyName: update?.companyName || current.companyName,
    systemPrompt: update?.systemPrompt || current.tenantPromptOverride || current.systemPrompt
  };

  await ensureTables(pool);

  await pool.query(
    `INSERT INTO agents (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_key)
     DO UPDATE SET agent_name = EXCLUDED.agent_name,
                   company_name = EXCLUDED.company_name,
                   system_prompt = EXCLUDED.system_prompt,
                   tenant_prompt_override = EXCLUDED.tenant_prompt_override,
                   updated_at = NOW()`,
    [next.tenantKey, next.agentName, next.companyName, next.systemPrompt, next.systemPrompt]
  );

  await pool.query(
    `INSERT INTO agent_versions (tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override)
     VALUES ($1, $2, $3, $4, $5)`,
    [next.tenantKey, next.agentName, next.companyName, next.systemPrompt, next.systemPrompt]
  );

  return { ...next, storage: "database" };
}

export async function listAgentConfigVersions(tenantKey = DEFAULT_TENANT_KEY, limit = 20) {
  const pool = getPool();
  if (!pool) {
    return [];
  }

  await ensureTables(pool);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

  const result = await pool.query(
    `SELECT id, tenant_key, agent_name, company_name, created_at, tenant_prompt_override
     FROM agent_versions
     WHERE tenant_key = $1
     ORDER BY id DESC
     LIMIT $2`,
    [tenantKey, safeLimit]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    tenantKey: row.tenant_key,
    agentName: row.agent_name,
    companyName: row.company_name,
    createdAt: row.created_at,
    tenantPromptOverride: row.tenant_prompt_override || ""
  }));
}

export async function restoreAgentConfigVersion(tenantKey = DEFAULT_TENANT_KEY, versionId) {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is required for version restore");
  }

  await ensureTables(pool);

  const result = await pool.query(
    `SELECT tenant_key, agent_name, company_name, system_prompt, tenant_prompt_override
     FROM agent_versions
     WHERE tenant_key = $1 AND id = $2
     LIMIT 1`,
    [tenantKey, Number(versionId)]
  );

  if (!result.rowCount) {
    throw new Error("version_not_found");
  }

  const row = result.rows[0];
  return setAgentConfig({
    tenantKey: row.tenant_key,
    agentName: row.agent_name,
    companyName: row.company_name,
    systemPrompt: row.tenant_prompt_override || row.system_prompt
  });
}
