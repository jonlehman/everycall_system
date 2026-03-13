export const KNOWLEDGE_ENTRY_TEMPLATES = [
  { sectionType: "services_and_capabilities", title: "Services and Capabilities" },
  { sectionType: "emergency_service", title: "Emergency Service" },
  { sectionType: "service_area", title: "Service Area" },
  { sectionType: "hours_and_availability", title: "Hours and Availability" },
  { sectionType: "warranties_and_guarantees", title: "Warranties and Guarantees" },
  { sectionType: "pricing_and_fees", title: "Pricing and Fees" },
  { sectionType: "financing_and_payment", title: "Financing and Payment" },
  { sectionType: "policies_and_process", title: "Policies and Process" }
];

export const GUARDRAIL_QUESTION_TEMPLATES = [
  { questionText: "How does your warranty work?", topic: "warranty", riskLevel: "critical" },
  { questionText: "Do you guarantee your work?", topic: "guarantees", riskLevel: "critical" },
  { questionText: "Do you offer emergency service?", topic: "emergency_service", riskLevel: "high" },
  { questionText: "What areas do you serve?", topic: "service_area", riskLevel: "high" },
  { questionText: "What are your hours and availability?", topic: "availability", riskLevel: "high" },
  { questionText: "Do you offer financing or payment plans?", topic: "financing", riskLevel: "high" },
  { questionText: "What are your service or diagnostic fees?", topic: "pricing", riskLevel: "critical" }
];

export function createBlankKnowledgeEntries() {
  return KNOWLEDGE_ENTRY_TEMPLATES.map((template) => ({
    ...template,
    contentText: "",
    sourceType: null,
    sourceUrl: null,
    sourceConfidence: null
  }));
}

export function createBlankGuardrailQuestionTests() {
  return GUARDRAIL_QUESTION_TEMPLATES.map((template) => ({
    ...template,
    answer: "",
    sourceType: null,
    sourceUrl: null,
    sourceConfidence: null
  }));
}
