import { DEFAULT_TENANT_KEY, getAgentConfig } from "../../../../_lib/agentConfig.js";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    const params = new URLSearchParams(req.body);
    return Object.fromEntries(params.entries());
  }

  return {};
}

function toInt(value, fallback = 0) {
  const num = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(num) ? num : fallback;
}

function looksLikeAddress(text) {
  const normalized = String(text || "").toLowerCase();
  const hasNumber = /\d/.test(normalized);
  const hasStreetToken = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|court|ct)\b/.test(
    normalized
  );
  const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(normalized);
  return (hasNumber && hasStreetToken) || hasZip;
}

function isDonePhrase(text) {
  return /\b(no|nope|that'?s it|thats it|nothing else|done|goodbye|bye)\b/i.test(String(text || ""));
}

function buildGatherTwiml(prompt, actionPath) {
  const escapedPrompt = escapeXml(prompt);
  const escapedAction = escapeXml(actionPath);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" action="${escapedAction}" method="POST">
    <Say voice="alice">${escapedPrompt}</Say>
  </Gather>
  <Say voice="alice">I didn't catch that. Please call again.</Say>
</Response>`;
}

async function generateReplyFromOpenAI(speechResult, systemPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return "Thanks. I captured that. What is the service address?";
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const payload = {
    model,
    input: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: speechResult
      }
    ]
  };

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      return "Thanks for that. Could you repeat your request in one sentence?";
    }

    const json = await resp.json();
    const outputText =
      json.output_text ||
      json.output
        ?.flatMap((item) => item.content || [])
        .find((item) => item.type === "output_text" && typeof item.text === "string")
        ?.text;

    if (!outputText) {
      return "Thanks. What service do you need help with today?";
    }

    return outputText.slice(0, 300);
  } catch {
    return "Thanks. Can you tell me your name and service address?";
  }
}

export default async function handler(req, res) {
  const cfg = await getAgentConfig(DEFAULT_TENANT_KEY);
  const body = parseBody(req);
  const speechResult = body.SpeechResult || body.speechresult;
  const query = req.query || {};
  const callSid = body.CallSid || "unknown";
  const turn = toInt(query.turn, 0);
  const hasAddress = String(query.hasAddress || "0") === "1";
  const actionBase = "/v1/twilio/webhooks/voice/inbound";

  if (!speechResult) {
    const twiml = buildGatherTwiml(
      `Thanks for calling ${cfg.companyName}. How can we help you today?`,
      `${actionBase}?turn=1&hasAddress=0`
    );
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.status(200).send(twiml);
    return;
  }

  const text = String(speechResult);
  const done = isDonePhrase(text);
  const detectedAddress = hasAddress || looksLikeAddress(text);

  if (done || turn >= 4) {
    const closingTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thanks. We captured your details and will follow up shortly. Goodbye.</Say>
</Response>`;
    res.setHeader("X-CallSid", String(callSid));
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.status(200).send(closingTwiml);
    return;
  }

  let aiReply;
  if (!process.env.OPENAI_API_KEY) {
    aiReply = detectedAddress
      ? "Perfect. I have your service address. What is the best callback number?"
      : "Thanks. I captured that. What is the full service address including zip code?";
  } else {
    aiReply = await generateReplyFromOpenAI(text, cfg.systemPrompt);
  }

  const nextTurn = turn + 1;
  const nextAddressFlag = detectedAddress ? 1 : 0;
  const nextActionPath = `${actionBase}?turn=${nextTurn}&hasAddress=${nextAddressFlag}`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapeXml(aiReply)}</Say>
  <Gather input="speech" speechTimeout="auto" action="${nextActionPath}" method="POST">
    <Say voice="alice">Anything else?</Say>
  </Gather>
  <Say voice="alice">Thanks for calling. Goodbye.</Say>
</Response>`;

  res.setHeader("X-CallSid", String(callSid));
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.status(200).send(twiml);
}
