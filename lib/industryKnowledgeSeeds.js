import { createBlankGuardrailQuestionTests, createBlankKnowledgeEntries } from "./knowledgeTemplates.js";

const INDUSTRY_SEED_CONFIGS = {
  plumbing: {
    services: "Handle drain cleaning, water heater repair and replacement, leak detection, sewer line work, fixture installs, repipes, and general plumbing repairs.",
    emergency: "Emergency plumbing requests may include active leaks, flooding, sewage backups, loss of water, or gas-related safety concerns. Gas smells should always be directed to 911 first.",
    serviceArea: "Serve the approved local metro area and nearby communities. Confirm coverage before promising a dispatch.",
    hours: "Business hours and dispatch windows vary. Same-day or after-hours response should only be promised after availability is confirmed.",
    warranties: "Warranty coverage may apply to qualifying repairs or installations. Do not imply that every plumbing job has the same warranty unless the business approved that wording.",
    pricing: "Do not quote exact prices unless the business explicitly approved them. Diagnostic fees, service fees, and estimate policies should be confirmed before booking.",
    financing: "If financing is available, explain it at a high level and let the team share the actual terms. Do not promise approval or payment amounts.",
    policies: "Collect the caller's name, callback number, service address, issue summary, urgency, and preferred timing. Answer direct questions first and avoid promising exact arrival times."
  },
  window_installers: {
    services: "Handle window replacement, custom window installs, glass replacement when supported, patio door projects, energy-efficient upgrades, and measurement appointments.",
    emergency: "Broken or unsafe windows may be urgent, but immediate response should be confirmed before it is promised.",
    serviceArea: "Serve the approved coverage area for estimates and installation work. Confirm location eligibility before booking.",
    hours: "Lead times depend on product availability, measuring, ordering, and installation schedule. Do not promise a delivery or install date until the team confirms it.",
    warranties: "Workmanship and manufacturer warranty details depend on the product and project scope. Share only the approved warranty description.",
    pricing: "Estimates depend on measurements, window type, and job scope. Do not quote exact prices or lead times until the team reviews the project.",
    financing: "If financing is offered, explain it generally and let the sales team share qualification details and terms.",
    policies: "Collect project address, window count or rough scope, timing, and callback information. Confirm whether replacement, repair, or a consultation is needed."
  },
  electrical: {
    services: "Handle panel upgrades, outlet and switch work, lighting installs, wiring repairs, EV chargers, diagnostics, and other licensed electrical service.",
    emergency: "Electrical emergencies may include burning smells, sparks, loss of power in critical areas, or safety hazards. Active smoke or fire should be directed to 911 immediately.",
    serviceArea: "Serve the approved local service area. Confirm address coverage before promising a visit.",
    hours: "Availability varies by schedule and urgency. Safety-critical issues may be prioritized, but exact timing should not be guaranteed until confirmed.",
    warranties: "Warranty or workmanship coverage depends on the approved company policy and the type of electrical work performed.",
    pricing: "Do not quote exact pricing without approved rate guidance. Diagnostic fees, permit-related costs, and material costs should be confirmed before booking.",
    financing: "If financing exists for larger projects, explain it generally and let the team share actual terms and approval steps.",
    policies: "Collect the issue summary, address, callback number, urgency, and any access notes. Avoid technical diagnosis beyond obvious safety guidance."
  },
  hvac: {
    services: "Handle furnace and AC repair, maintenance, heat pumps, indoor air quality work, thermostat issues, system replacement, and related HVAC service.",
    emergency: "No-heat or no-cooling situations may be urgent depending on weather and occupant safety, but emergency dispatch should only be promised after availability is confirmed.",
    serviceArea: "Serve the approved service area and nearby communities. Confirm eligibility before booking service.",
    hours: "Response windows depend on demand, weather, and schedule. Do not promise same-day or after-hours service until the team confirms it.",
    warranties: "Warranty coverage may differ between repairs, workmanship, and equipment manufacturer coverage. Share only approved warranty language.",
    pricing: "Do not quote exact repair or replacement pricing unless the business approved it. Diagnostic fees and estimate policies should be confirmed before scheduling.",
    financing: "If financing is offered for replacement projects, explain it generally and let the team share terms and approvals.",
    policies: "Collect system type, issue summary, callback number, service address, urgency, and preferred timing. Avoid technical troubleshooting beyond simple safe checks."
  },
  roofing: {
    services: "Handle roof repair, replacement, inspections, storm-damage evaluations, flashing work, leak response, gutters, and related roofing service.",
    emergency: "Active leaks or storm damage may be urgent, and temporary protection may be available, but exact response timing should be confirmed before promising it.",
    serviceArea: "Serve the approved local coverage area. Confirm service availability before booking inspections or repairs.",
    hours: "Scheduling depends on weather, crew availability, and project scope. Do not guarantee an inspection or install date until confirmed.",
    warranties: "Workmanship and manufacturer warranty coverage depend on the roofing system and project scope. Share only approved warranty details.",
    pricing: "Do not quote exact repair or replacement pricing without an inspection or approved price guidance. Insurance-related costs should also be confirmed by the team.",
    financing: "If financing is available, explain it generally and let the team provide actual terms.",
    policies: "Collect address, leak or damage summary, urgency, callback number, and insurance involvement. Set expectations for follow-up without promising exact timelines."
  },
  landscaping: {
    services: "Handle lawn care, irrigation, cleanups, planting, hardscaping, drainage improvements, tree and shrub maintenance, and recurring landscape service when offered.",
    emergency: "Most landscaping requests are scheduled rather than emergency work. Urgent storm cleanup or drainage issues should still be confirmed before promising immediate response.",
    serviceArea: "Serve the approved local service area. Confirm address coverage before booking an estimate or recurring service.",
    hours: "Scheduling depends on weather, season, and crew capacity. Do not promise an exact start date until the team confirms availability.",
    warranties: "Guarantees vary by project type, plant material, workmanship, and maintenance responsibilities. Share only approved warranty or guarantee language.",
    pricing: "Quotes depend on property size, scope, materials, and frequency. Do not quote exact pricing until the team reviews the request.",
    financing: "Financing is not standard for every landscaping project. Confirm availability before offering payment-plan language.",
    policies: "Collect service address, property type, requested work, timing, and callback details. Clarify whether the caller wants recurring service, a one-time project, or an estimate."
  },
  cleaning: {
    services: "Handle recurring home cleaning, deep cleans, move-in or move-out work, standard checklists, and add-on cleaning services when offered.",
    emergency: "Cleaning is usually scheduled service. Same-day or urgent availability should be confirmed before promising it.",
    serviceArea: "Serve the approved local area. Confirm coverage and travel limits before booking.",
    hours: "Availability depends on route density, crew schedule, and service type. Do not promise same-day service or a precise arrival window until confirmed.",
    warranties: "If the business offers a satisfaction policy or re-clean window, state only the approved terms and avoid implying a blanket guarantee.",
    pricing: "Pricing depends on home size, condition, checklist, and frequency. Do not quote exact amounts until the business approves them.",
    financing: "Financing is uncommon for cleaning service. Confirm whether payment plans exist before mentioning them.",
    policies: "Collect service address, home size or job scope, preferred frequency, pets or access notes, callback number, and timing preferences."
  },
  pest_control: {
    services: "Handle inspections, one-time treatments, recurring pest plans, rodent work, exclusion recommendations, and specialized pest treatment when offered.",
    emergency: "Infestations can feel urgent, but response timing should still be confirmed before it is promised. Safety instructions should follow the approved treatment process.",
    serviceArea: "Serve the approved local service area. Confirm coverage before booking treatment.",
    hours: "Availability depends on technician schedule and treatment type. Do not promise same-day service until the team confirms it.",
    warranties: "Re-service windows, treatment guarantees, and plan coverage depend on the pest type and the business policy. Share only approved terms.",
    pricing: "Do not quote exact treatment prices until the business confirms pest type, property details, and service scope.",
    financing: "If financing or payment plans exist for larger remediation projects, explain them generally and let the team provide details.",
    policies: "Collect the pest type if known, property type, address, urgency, callback number, and whether the request is for one-time service or a recurring plan."
  },
  garage_door: {
    services: "Handle broken spring repair, opener repair and installation, off-track doors, cable issues, door replacement, tune-ups, and sensor work.",
    emergency: "A stuck, unsafe, or unsecured garage door may be urgent, but same-day or after-hours response should only be promised after availability is confirmed.",
    serviceArea: "Serve the approved local coverage area. Confirm the address before scheduling.",
    hours: "Scheduling depends on route availability and the severity of the issue. Do not guarantee same-day arrival until it is confirmed.",
    warranties: "Warranty coverage may differ between parts, labor, and new door installations. Share only the approved warranty description.",
    pricing: "Do not quote exact repair or replacement pricing unless the business approved it. Parts compatibility and scope should be confirmed first.",
    financing: "If financing is available for larger replacement projects, explain it generally and let the team provide actual terms.",
    policies: "Collect the caller's callback number, service address, door issue, urgency, and timing preference. Remind callers not to operate an unsafe door."
  },
  general_contractor: {
    services: "Handle remodels, additions, kitchens, bathrooms, structural upgrades, scope reviews, estimating, scheduling, and permit coordination when offered.",
    emergency: "Most contractor projects are scheduled work. Urgent structural or damage situations should be acknowledged, but immediate response should be confirmed before promising it.",
    serviceArea: "Serve the approved project area. Confirm location and project fit before booking.",
    hours: "Project start dates depend on scope, permitting, design, materials, and crew availability. Do not promise a start date until the team confirms it.",
    warranties: "Workmanship warranty coverage depends on the approved contract terms and project scope. Share only approved warranty language.",
    pricing: "Do not quote exact project pricing without a scope review. Explain that estimates depend on details, site conditions, materials, and permitting.",
    financing: "If financing exists, explain it at a high level and let the team share real terms and qualification requirements.",
    policies: "Collect project address, type of work, rough timeline, callback number, budget sensitivity, and any permitting or insurance context."
  },
  locksmith: {
    services: "Handle lockout service, rekeying, lock replacement, smart-lock installs, key duplication, access hardware, and related locksmith work when offered.",
    emergency: "Lockouts or security issues may be urgent, but arrival timing should only be promised after availability is confirmed.",
    serviceArea: "Serve the approved coverage area. Confirm location and service eligibility before dispatch.",
    hours: "After-hours and emergency availability should be confirmed before it is promised.",
    warranties: "Warranty coverage depends on the specific hardware or workmanship policy. Share only approved warranty details.",
    pricing: "Do not quote exact trip, service, or hardware pricing until the business confirms the request details and service area.",
    financing: "Financing is uncommon for locksmith work. Confirm whether it exists before mentioning it.",
    policies: "Collect the callback number, service address, lockout or hardware issue, urgency, and any proof-of-ownership requirements before dispatch."
  }
};

function normalizeText(value) {
  return String(value || "").trim();
}

export function getIndustryKnowledgeSeed(industryKey) {
  const config = INDUSTRY_SEED_CONFIGS[industryKey];
  const blankEntries = createBlankKnowledgeEntries();
  const blankGuardrails = createBlankGuardrailQuestionTests();

  if (!config) {
    return {
      knowledgeEntries: blankEntries,
      guardrailQuestionTests: blankGuardrails
    };
  }

  const entryContentBySection = {
    services_and_capabilities: config.services,
    emergency_service: config.emergency,
    service_area: config.serviceArea,
    hours_and_availability: config.hours,
    warranties_and_guarantees: config.warranties,
    pricing_and_fees: config.pricing,
    financing_and_payment: config.financing,
    policies_and_process: config.policies
  };

  const guardrailAnswerByTopic = {
    warranty: config.guardrails?.warranty || config.warranties,
    guarantees: config.guardrails?.guarantees || config.warranties,
    emergency_service: config.guardrails?.emergency_service || config.emergency,
    service_area: config.guardrails?.service_area || config.serviceArea,
    availability: config.guardrails?.availability || config.hours,
    financing: config.guardrails?.financing || config.financing,
    pricing: config.guardrails?.pricing || config.pricing
  };

  return {
    knowledgeEntries: blankEntries.map((template) => ({
      ...template,
      contentText: normalizeText(entryContentBySection[template.sectionType]),
      sourceType: "industry_seed",
      sourceUrl: null,
      sourceConfidence: normalizeText(entryContentBySection[template.sectionType]) ? 1 : null
    })),
    guardrailQuestionTests: blankGuardrails.map((template) => ({
      ...template,
      answer: normalizeText(guardrailAnswerByTopic[template.topic]),
      sourceType: "industry_seed",
      sourceUrl: null,
      sourceConfidence: normalizeText(guardrailAnswerByTopic[template.topic]) ? 1 : null
    }))
  };
}

export const INDUSTRY_KNOWLEDGE_SEED_KEYS = Object.freeze(Object.keys(INDUSTRY_SEED_CONFIGS));
