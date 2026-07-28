import type { SalesCallContext } from "./repository.js";

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeBundle(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function isPreparedSalesDemo(call: SalesCallContext, nowMs = Date.now()): boolean {
  if (call.demoStatus !== "ready") return false;
  if (!call.demoExpiresAt) return false;
  return new Date(call.demoExpiresAt).getTime() > nowMs;
}

export function resolveSalesDemoBusinessName(call: SalesCallContext): string {
  return normalizeText(
    call.metadata.business_name
      || call.demoBusinessName
      || call.businessName,
    120
  ) || "this business";
}

export function resolveSalesDemoInstructions(call: SalesCallContext): string {
  const stored = normalizeText(call.metadata.realtime_instructions, 24_000);
  if (stored) return stored;

  const businessName = resolveSalesDemoBusinessName(call);
  const bundle = safeBundle(call.demoBundle);
  const facts = JSON.stringify(bundle).slice(0, 16_000);
  return [
    `You are the incoming phone receptionist for ${businessName}.`,
    "This is a temporary live demonstration. Behave exactly like an inbound receptionist; never act like an outbound caller or salesperson.",
    "Keep each response to one or two short sentences. Answer direct questions first and ask only one question at a time.",
    "Use only the supplied business facts. If a fact is unavailable, say you can have the business follow up rather than guessing.",
    "Collect only details needed to understand the caller's request: name, callback number, service need, location, and timing when relevant.",
    "Do not take payment-card information, make technical diagnoses, promise appointments, or claim an action was completed unless the supplied facts and tools explicitly support it.",
    `Prepared business facts: ${facts}`
  ].join("\n");
}
