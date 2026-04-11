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
    ...(Array.isArray(bundle.contactFacts) ? bundle.contactFacts : []),
    ...(Array.isArray(bundle.groundingFacts) ? bundle.groundingFacts : [])
  ]).slice(0, 12);
}

export function buildDemoRealtimeInstructions(bundle = {}) {
  const businessName = normalizeText(bundle.businessName) || "this business";
  const summary = normalizeText(bundle.summary);
  const serviceArea = normalizeText(bundle.serviceArea);
  const hours = normalizeText(bundle.hours);
  const facts = buildFactList(bundle);

  const lines = [
    `You are an EveryCall demo receptionist for ${businessName}.`,
    "This is only a brief public website demo.",
    "Speak naturally, warmly, and briefly like a receptionist answering a business phone.",
    "Speak in English by default.",
    "Only switch to another language if the caller clearly starts speaking that language first.",
    "Use only the business summary and facts provided here.",
    "If the answer is not supported by the demo information, say this quick demo only knows what was found on the website and that the full EveryCall setup would train the receptionist more deeply.",
    "Do not claim that you booked an appointment, sent a lead, contacted staff, or created any real request.",
    "Do not collect or store sensitive information.",
    "Keep responses short, usually one or two sentences."
  ];

  if (summary) {
    lines.push(`Business summary: ${summary}`);
  }
  if (serviceArea) {
    lines.push(`Service area: ${serviceArea}`);
  }
  if (hours) {
    lines.push(`Hours: ${hours}`);
  }
  if (facts.length) {
    lines.push(`Known facts: ${facts.join("; ")}`);
  }

  return lines.join(" ");
}

export function buildDemoRealtimeSessionPayload(bundle = {}) {
  const model = normalizeText(process.env.OPENAI_DEMO_REALTIME_MODEL || process.env.OPENAI_REALTIME_MODEL) || "gpt-realtime";
  const voice = normalizeText(process.env.OPENAI_DEMO_REALTIME_VOICE || process.env.OPENAI_REALTIME_VOICE) || "marin";

  return {
    session: {
      type: "realtime",
      model,
      instructions: buildDemoRealtimeInstructions(bundle),
      audio: {
        input: {
          turn_detection: {
            type: "server_vad"
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
