function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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

async function generateReplyFromOpenAI(speechResult) {
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
        content:
          "You are EveryCall, a concise phone assistant for home service businesses. Keep replies under 25 words, ask one clarifying question, no markdown."
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
  const body = parseBody(req);
  const speechResult = body.SpeechResult || body.speechresult;
  const callSid = body.CallSid || "unknown";
  const actionPath = "/v1/twilio/webhooks/voice/inbound";

  if (!speechResult) {
    const twiml = buildGatherTwiml(
      "Thanks for calling EveryCall. How can we help you today?",
      actionPath
    );
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.status(200).send(twiml);
    return;
  }

  const aiReply = await generateReplyFromOpenAI(String(speechResult));
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapeXml(aiReply)}</Say>
  <Gather input="speech" speechTimeout="auto" action="${actionPath}" method="POST">
    <Say voice="alice">Anything else?</Say>
  </Gather>
  <Say voice="alice">Thanks for calling. Goodbye.</Say>
</Response>`;

  res.setHeader("X-CallSid", String(callSid));
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.status(200).send(twiml);
}
