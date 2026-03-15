const PACK_VERSION = "1.0.0";

const seedDomains = [
  ["service_business", "Service Business", "Shared receptionist behavior for home and field service businesses."],
  ["medical", "Medical", "Shared front-desk behavior for medical offices."],
  ["dental", "Dental", "Shared front-desk behavior for dental practices."],
  ["therapy_practice", "Therapy Practice", "Shared receptionist behavior for therapy practices."],
  ["legal", "Legal", "Shared intake behavior for legal firms."],
  ["accounting", "Accounting", "Shared intake behavior for accounting firms."],
  ["professional_services", "Professional Services", "Shared receptionist behavior for non-regulated professional services."],
  ["wellness_beauty", "Wellness & Beauty", "Shared receptionist behavior for wellness and beauty businesses."],
  ["real_estate_property", "Real Estate & Property", "Shared receptionist behavior for property businesses."],
  ["education_training", "Education & Training", "Shared receptionist behavior for education and training businesses."],
  ["retail_showroom", "Retail Showroom", "Shared receptionist behavior for appointment-led showroom businesses."]
];

const seedSubdomains = [
  ["service_business.plumbing", "service_business", "Plumbing", "Plumbing-specific deltas for service businesses."],
  ["service_business.hvac", "service_business", "HVAC", "HVAC-specific deltas for service businesses."],
  ["service_business.electrical", "service_business", "Electrical", "Electrical-specific deltas for service businesses."],
  ["service_business.roofing", "service_business", "Roofing", "Roofing-specific deltas for service businesses."],
  ["service_business.window_installation", "service_business", "Window Installation", "Window installation deltas for service businesses."],
  ["service_business.garage_door", "service_business", "Garage Door", "Garage door deltas for service businesses."],
  ["service_business.locksmith", "service_business", "Locksmith", "Locksmith deltas for service businesses."],
  ["service_business.cleaning", "service_business", "Cleaning", "Cleaning deltas for service businesses."],
  ["service_business.pest_control", "service_business", "Pest Control", "Pest-control deltas for service businesses."],
  ["service_business.landscaping", "service_business", "Landscaping", "Landscaping deltas for service businesses."],
  ["service_business.general_contracting", "service_business", "General Contracting", "General contracting deltas for service businesses."],
  ["medical.primary_care", "medical", "Primary Care", "Primary-care deltas for medical offices."],
  ["medical.dermatology", "medical", "Dermatology", "Dermatology deltas for medical offices."],
  ["medical.pediatrics", "medical", "Pediatrics", "Pediatrics deltas for medical offices."],
  ["medical.chiropractic", "medical", "Chiropractic", "Chiropractic deltas for medical offices."],
  ["dental.general_dentistry", "dental", "General Dentistry", "General-dentistry deltas for dental practices."],
  ["dental.orthodontics", "dental", "Orthodontics", "Orthodontics deltas for dental practices."],
  ["therapy_practice.individual_therapy", "therapy_practice", "Individual Therapy", "Individual-therapy deltas for therapy practices."],
  ["therapy_practice.couples_therapy", "therapy_practice", "Couples Therapy", "Couples-therapy deltas for therapy practices."],
  ["legal.estate_planning", "legal", "Estate Planning", "Estate-planning deltas for legal firms."],
  ["legal.family_law", "legal", "Family Law", "Family-law deltas for legal firms."],
  ["legal.personal_injury", "legal", "Personal Injury", "Personal-injury deltas for legal firms."],
  ["accounting.cpa_firm", "accounting", "CPA Firm", "CPA-firm deltas for accounting firms."],
  ["accounting.bookkeeping", "accounting", "Bookkeeping", "Bookkeeping deltas for accounting firms."],
  ["accounting.tax_prep", "accounting", "Tax Prep", "Tax-prep deltas for accounting firms."],
  ["professional_services.managed_it_services", "professional_services", "Managed IT Services", "Managed-IT-service deltas for professional services."],
  ["professional_services.marketing_agency", "professional_services", "Marketing Agency", "Marketing-agency deltas for professional services."],
  ["professional_services.business_consulting", "professional_services", "Business Consulting", "Business-consulting deltas for professional services."],
  ["wellness_beauty.med_spa", "wellness_beauty", "Med Spa", "Med-spa deltas for wellness and beauty businesses."],
  ["wellness_beauty.salon", "wellness_beauty", "Salon", "Salon deltas for wellness and beauty businesses."],
  ["real_estate_property.property_management", "real_estate_property", "Property Management", "Property-management deltas for property businesses."],
  ["real_estate_property.brokerage", "real_estate_property", "Brokerage", "Brokerage deltas for property businesses."],
  ["education_training.tutoring", "education_training", "Tutoring", "Tutoring deltas for education and training businesses."],
  ["education_training.music_lessons", "education_training", "Music Lessons", "Music-lesson deltas for education and training businesses."],
  ["retail_showroom.showroom_appointments", "retail_showroom", "Showroom Appointments", "Showroom-appointment deltas for retail showrooms."]
];

function buildDefaultDomainPack(domainId, name, description) {
  return {
    domain_id: domainId,
    name,
    version: PACK_VERSION,
    status: "new",
    description,
    naics_codes: [],
    intent_catalog: [],
    entity_catalog: [],
    page_type_weights: {},
    content_class_biases: {},
    ranking_rules: [],
    boundary_rules: [],
    clarification_rules: [],
    default_stage_guidance: [],
    default_prompt_fragments: [],
    required_eval_suites: ["schema_validation", "runtime_bundle_budget"]
  };
}

function buildDefaultSubdomainPack(subdomainId, parentDomainId, name, description) {
  return {
    subdomain_id: subdomainId,
    parent_domain_id: parentDomainId,
    name,
    version: PACK_VERSION,
    status: "new",
    description,
    additional_intents: [],
    additional_entities: [],
    page_type_weight_deltas: {},
    content_class_bias_deltas: {},
    ranking_rule_deltas: [],
    boundary_rule_deltas: [],
    clarification_rule_deltas: [],
    stage_guidance_deltas: [],
    prompt_fragment_deltas: [],
    required_eval_suites: ["schema_validation", "runtime_bundle_budget"]
  };
}

export const domainPackDefinitions = seedDomains.map(([domainId, name, description]) =>
  buildDefaultDomainPack(domainId, name, description)
);

export const subdomainPackDefinitions = seedSubdomains.map(([subdomainId, parentDomainId, name, description]) =>
  buildDefaultSubdomainPack(subdomainId, parentDomainId, name, description)
);

export function getPackDefinitionsVersion() {
  return PACK_VERSION;
}
