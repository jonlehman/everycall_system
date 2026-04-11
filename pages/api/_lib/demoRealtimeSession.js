import {
  getDefaultPromptBlueprintSeed,
  normalizeTenantPromptProfile,
  renderPromptContext
} from "@everycall/contracts";

function normalizeText(value) {
  return String(value || "").trim();
}

function uniqueValues(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function buildFactList(bundle = {}) {
  return uniqueValues([
    ...(Array.isArray(bundle.topServices) ? bundle.topServices : []),
    normalizeText(bundle.serviceArea),
    normalizeText(bundle.hours),
    normalizeText(bundle.emergencyAvailability),
    ...(Array.isArray(bundle.customerTypes) ? bundle.customerTypes : []),
    ...(Array.isArray(bundle.contactFacts) ? bundle.contactFacts : []),
    ...(Array.isArray(bundle.approvedFacts) ? bundle.approvedFacts : []),
    ...(Array.isArray(bundle.groundingFacts) ? bundle.groundingFacts : [])
  ]).slice(0, 12);
}

function buildDemoTenantProfile(bundle = {}) {
  const businessName = normalizeText(bundle.businessName) || "This Business";
  const summary = normalizeText(bundle.summary)
    || normalizeText(bundle.previewSummary)
    || `${businessName} provides the services described in this website demo.`;

  return normalizeTenantPromptProfile({
    assistant_name: "Sarah",
    business_name: businessName,
    company_description: summary,
    basic_no_tool_allowed_statement: summary,
    opening_line: `Hi, thanks for calling ${businessName}. This is Sarah. How can I help you?`
  });
}

function buildDemoSectionOverrides(bundle = {}) {
  const summary = normalizeText(bundle.summary)
    || normalizeText(bundle.previewSummary)
    || "This quick public demo only knows what was found on the website.";

  return {
    business_context: `# Business Context
${summary}

This public demo does not use live tools or a live submission workflow.
- Answer only from the business summary and confirmed facts included in this prompt.
- You may still conversationally collect callback information from interested callers, just like the live receptionist would.
- Do not act as if collected information was submitted, stored, or sent to staff.
- If the answer is not supported here, say this quick demo only knows what was found on the website and that the full EveryCall setup would train the receptionist more deeply.`,
    tools: `# Tools
There are no live tools in this public demo.
- Do not call tools.
- Do not mention internal tools, lookups, packets, workflows, gateway calls, or system logic.
- If you collect callback information conversationally, do not act as if it was submitted anywhere.
- Do not act as if you sent a message, created a request, or notified staff.`,
    knowledge_boundaries: `# Factual Boundaries & Uncertainty
- Never answer business-specific factual questions from general intuition.
- Never invent business facts.
- Answer only from the business summary and confirmed facts in this prompt.
- If a detail is not confirmed here, say this quick demo only knows what was found on the website and that the full EveryCall setup would train the receptionist more deeply.
- Do not pretend to perform a lookup or check another system during this public demo.`,
    closing: `# Closing
- Close warmly and briefly.
- Thank the caller.
- Use this closing style when it fits: Thanks for calling. Have a great rest of your day.
- Do not claim an action was completed unless it actually was.
- In this public demo, never claim that a lead was sent, staff were notified, or a request was created.`
  };
}

function buildDemoFactPack(bundle = {}) {
  const facts = buildFactList(bundle);
  const lines = [
    "# Demo Fact Pack",
    "Use only the confirmed website-derived information below when answering business-specific questions."
  ];

  if (normalizeText(bundle.summary)) {
    lines.push(`Business summary: ${normalizeText(bundle.summary)}`);
  }
  if (normalizeText(bundle.serviceArea)) {
    lines.push(`Service area: ${normalizeText(bundle.serviceArea)}`);
  }
  if (normalizeText(bundle.hours)) {
    lines.push(`Hours: ${normalizeText(bundle.hours)}`);
  }
  if (normalizeText(bundle.emergencyAvailability)) {
    lines.push(`Emergency or after-hours availability: ${normalizeText(bundle.emergencyAvailability)}`);
  }
  if (facts.length) {
    lines.push(`Known facts: ${facts.join("; ")}`);
  }
  if (Array.isArray(bundle.unsupportedTopics) && bundle.unsupportedTopics.length) {
    lines.push(`Unsupported or unconfirmed topics: ${bundle.unsupportedTopics.join("; ")}`);
  }

  return lines.join("\n");
}

export function buildDemoRealtimeInstructions(bundle = {}) {
  const blueprint = getDefaultPromptBlueprintSeed();
  const tenantProfile = buildDemoTenantProfile(bundle);
  const rendered = renderPromptContext(blueprint, tenantProfile, {
    companyDescription: tenantProfile.company_description,
    companyDescriptionSource: "tenant_override",
    sectionOverrides: buildDemoSectionOverrides(bundle)
  });

  const lines = [
    rendered.startupPrompt,
    "# Demo Rules",
    "- This is only a brief public website demo.",
    "- Speak in English by default.",
    "- Only switch to another language if the caller clearly starts speaking that language first.",
    "- Do not collect or store sensitive information.",
    "- Keep responses short, usually one or two sentences.",
    buildDemoFactPack(bundle)
  ];

  return lines.filter(Boolean).join("\n\n");
}

function resolveDemoRealtimeModel() {
  const configured = normalizeText(process.env.OPENAI_DEMO_REALTIME_MODEL || process.env.OPENAI_REALTIME_MODEL);
  if (!configured || configured === "gpt-realtime") {
    return "gpt-realtime-1.5";
  }
  return configured;
}

function resolveDemoTranscriptionModel() {
  return normalizeText(process.env.OPENAI_DEMO_TRANSCRIPTION_MODEL || process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL)
    || "gpt-4o-mini-transcribe";
}

export function buildDemoRealtimeSessionPayload(bundle = {}) {
  const model = resolveDemoRealtimeModel();
  const voice = normalizeText(process.env.OPENAI_DEMO_REALTIME_VOICE || process.env.OPENAI_REALTIME_VOICE) || "marin";
  const transcriptionModel = resolveDemoTranscriptionModel();

  return {
    session: {
      type: "realtime",
      model,
      instructions: buildDemoRealtimeInstructions(bundle),
      audio: {
        input: {
          transcription: {
            model: transcriptionModel,
            language: "en"
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.85,
            prefix_padding_ms: 300,
            silence_duration_ms: 650,
            idle_timeout_ms: null,
            create_response: true,
            interrupt_response: true
          }
        },
        output: {
          voice
        }
      }
    },
    model,
    voice
  };
}
