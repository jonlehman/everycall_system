import express from "express";
import { readCallGatewayEnv } from "@everycall/config";
import { logError, logInfo } from "@everycall/observability";
import { normalizePhone, validateTelnyxSignature } from "@everycall/telephony";
import pg from "pg";

const env = readCallGatewayEnv(process.env);
const app = express();
const databaseUrl = process.env.DATABASE_URL || "";
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;
const appBaseUrl = process.env.APP_BASE_URL || "";
const callSummaryToken = process.env.CALL_SUMMARY_TOKEN || "";
const callGatewayBaseUrl = process.env.CALL_GATEWAY_BASE_URL || "";
const openAiKey = process.env.OPENAI_API_KEY || "";
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const signatureRequired = (process.env.TELNYX_SIGNATURE_REQUIRED || "true").toLowerCase() !== "false";

app.set("trust proxy", true);

function parseFormBody(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function parseTelnyxParams(rawBody: string, contentType: string | undefined): Record<string, string> {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/json") && rawBody.trim().startsWith("{")) {
    try {
      const json = JSON.parse(rawBody);
      if (json && typeof json === "object") {
        return Object.fromEntries(
          Object.entries(json).map(([key, value]) => [key, String(value ?? "")])
        );
      }
    } catch {
      return {};
    }
  }
  return parseFormBody(rawBody);
}

function buildBaseUrl(req: express.Request) {
  if (callGatewayBaseUrl) return callGatewayBaseUrl;
  return `${req.protocol}://${req.get("host")}`;
}

function buildTeXMLResponse(prompt: string, actionUrl: string) {
  const escaped = prompt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Gather input="speech" speechTimeout="2" language="en-US" action="${actionUrl}" method="POST">\n    <Say>${escaped}</Say>\n  </Gather>\n  <Say>We didn't catch that. Please call again.</Say>\n</Response>`;
}

function buildHangupResponse(text: string) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>${escaped}</Say>\n  <Hangup/>\n</Response>`;
}

function isDonePhrase(text: string) {
  return /\b(no|nope|that'?s it|thats it|nothing else|done|goodbye|bye|stop)\b/i.test(String(text || ""));
}

async function composePromptForTenant(tenantKey: string) {
  if (!pool) return "";
  const systemParts = await pool.query(
    `SELECT global_emergency_phrase,
            personality_prompt,
            datetime_prompt,
            numbers_symbols_prompt,
            confirmation_prompt,
            faq_usage_prompt
     FROM system_config
     WHERE id = 1`
  );
  const tenantRow = await pool.query(
    `SELECT industry FROM tenants WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );
  const industryKey = tenantRow.rows[0]?.industry || null;
  const industryPromptRow = industryKey
    ? await pool.query(`SELECT prompt FROM industry_prompts WHERE industry_key = $1`, [industryKey])
    : { rows: [] };
  const tenantPromptRow = await pool.query(
    `SELECT tenant_prompt_override, system_prompt FROM agents WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey]
  );

  const sections: string[] = [];
  const format = (title: string, body?: string) => (body ? `# ${title}\n${body}` : "");
  sections.push(format("SYSTEM EMERGENCY PHRASE", systemParts.rows[0]?.global_emergency_phrase));
  sections.push(format("PERSONALITY", systemParts.rows[0]?.personality_prompt));
  sections.push(format("DATE & TIME", systemParts.rows[0]?.datetime_prompt));
  sections.push(format("NUMBERS & SYMBOLS", systemParts.rows[0]?.numbers_symbols_prompt));
  sections.push(format("CONFIRMATION", systemParts.rows[0]?.confirmation_prompt));
  sections.push(format("WHEN TO USE FAQ", systemParts.rows[0]?.faq_usage_prompt));
  sections.push(format("INDUSTRY PROMPT", industryPromptRow.rows[0]?.prompt));
  const tenantOverride = tenantPromptRow.rows[0]?.tenant_prompt_override || tenantPromptRow.rows[0]?.system_prompt || "";
  sections.push(format("TENANT PROMPT OVERRIDE", tenantOverride));
  return sections.filter(Boolean).join("\n\n");
}

async function generateAssistantReply(prompt: string, history: Array<{ role: string; content: string }>, userText: string) {
  if (!openAiKey) {
    return "Thanks. What is the service address and best callback number?";
  }
  const input = [
    { role: "system", content: prompt },
    ...history,
    { role: "user", content: userText }
  ];
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: openAiModel, input })
  });
  if (!resp.ok) {
    return "Thanks. Can you share your service address and best callback number?";
  }
  const json = await resp.json();
  const text =
    json.output_text ||
    json.output
      ?.flatMap((item: any) => item.content || [])
      .find((item: any) => item.type === "output_text" && typeof item.text === "string")
      ?.text;
  return String(text || "").slice(0, 400) || "Thanks. What is the service address?";
}

function verifyTelnyx(req: express.Request, rawBody: string) {
  const signature = req.header("telnyx-signature-ed25519");
  const timestamp = req.header("telnyx-timestamp");
  return validateTelnyxSignature({
    signatureHeader: signature,
    timestampHeader: timestamp,
    publicKey: env.TELNYX_PUBLIC_KEY,
    rawBody
  });
}

app.post("/v1/telnyx/texml/inbound", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  logInfo("telnyx_texml_inbound_request", {
    path: req.path,
    contentLength: req.header("content-length"),
    contentType: req.header("content-type"),
    hasSignature: Boolean(req.header("telnyx-signature-ed25519")),
    hasTimestamp: Boolean(req.header("telnyx-timestamp")),
    bodyPreview: rawBody ? rawBody.slice(0, 200) : ""
  });
  if (signatureRequired && !verifyTelnyx(req, rawBody)) {
    logError("telnyx_signature_invalid", {
      path: req.path,
      hasSignature: Boolean(req.header("telnyx-signature-ed25519")),
      hasTimestamp: Boolean(req.header("telnyx-timestamp"))
    });
    return res.status(401).send("invalid_signature");
  }
  if (!pool) {
    res.type("text/xml").status(200).send(buildHangupResponse("Thanks for calling. Goodbye."));
    return;
  }

  try {
    const params = parseTelnyxParams(rawBody, req.header("content-type"));
    const toRaw = String(params.To || "");
    const fromRaw = String(params.From || "");
    const to = normalizePhone(toRaw);
    const from = normalizePhone(fromRaw);
    const callSid = String(params.CallSid || "unknown");
    logInfo("telnyx_texml_inbound_params", {
      callSid,
      toRaw,
      fromRaw,
      to,
      from
    });

    const tenantRow = await pool.query(
      `SELECT tenant_key, status, name FROM tenants WHERE telnyx_voice_number = $1 LIMIT 1`,
      [to]
    );
    logInfo("telnyx_texml_inbound_tenant_lookup", {
      callSid,
      matched: Boolean(tenantRow.rowCount),
      tenantKey: tenantRow.rows[0]?.tenant_key,
      status: tenantRow.rows[0]?.status
    });
    if (!tenantRow.rowCount || tenantRow.rows[0].status !== "active") {
      res.type("text/xml").status(200).send(buildHangupResponse("Thanks for calling. Goodbye."));
      return;
    }
    const tenantKey = tenantRow.rows[0].tenant_key;
    const companyName = tenantRow.rows[0].name || "our team";

    await pool.query(
      `INSERT INTO calls (call_sid, tenant_key, from_number, to_number, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       ON CONFLICT (call_sid)
       DO UPDATE SET from_number = EXCLUDED.from_number,
                     to_number = EXCLUDED.to_number`,
      [callSid, tenantKey, from, to]
    );

    await pool.query(
      `INSERT INTO call_details (call_sid, state_json)
       VALUES ($1, $2)
       ON CONFLICT (call_sid)
       DO UPDATE SET state_json = COALESCE(call_details.state_json, EXCLUDED.state_json)`,
      [callSid, JSON.stringify({ turn: 0, history: [] })]
    );

    const greeting = `Thanks for calling ${companyName}. I can help get you scheduled. What's your name and best callback number?`;
    const actionUrl = `${buildBaseUrl(req)}/v1/telnyx/texml/gather?tenantKey=${encodeURIComponent(tenantKey)}&callSid=${encodeURIComponent(callSid)}`;
    logInfo("telnyx_texml_inbound_response", {
      callSid,
      tenantKey,
      actionUrl
    });
    res.type("text/xml").status(200).send(buildTeXMLResponse(greeting, actionUrl));
  } catch (err) {
    logError("telnyx_texml_inbound_error", {
      message: err instanceof Error ? err.message : "unknown"
    });
    res.type("text/xml").status(200).send(buildHangupResponse("We are unable to take your call right now."));
  }
});

app.post("/v1/telnyx/texml/debug", express.raw({ type: "*/*" }), (_req, res) => {
  res
    .type("text/xml")
    .status(200)
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say>Everycall debug endpoint is live.</Say>\n  <Hangup/>\n</Response>`
    );
});

app.post("/v1/telnyx/texml/gather", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  logInfo("telnyx_texml_gather_request", {
    path: req.path,
    contentLength: req.header("content-length"),
    contentType: req.header("content-type"),
    hasSignature: Boolean(req.header("telnyx-signature-ed25519")),
    hasTimestamp: Boolean(req.header("telnyx-timestamp")),
    bodyPreview: rawBody ? rawBody.slice(0, 200) : ""
  });
  if (signatureRequired && !verifyTelnyx(req, rawBody)) {
    logError("telnyx_signature_invalid", {
      path: req.path,
      hasSignature: Boolean(req.header("telnyx-signature-ed25519")),
      hasTimestamp: Boolean(req.header("telnyx-timestamp"))
    });
    return res.status(401).send("invalid_signature");
  }
  if (!pool) {
    res.type("text/xml").status(200).send(buildHangupResponse("Thanks for calling. Goodbye."));
    return;
  }

  try {
    const params = parseTelnyxParams(rawBody, req.header("content-type"));
    const tenantKey = String(req.query?.tenantKey || "");
    const callSid = String(req.query?.callSid || params.CallSid || "unknown");
    const speech = String(params.SpeechResult || "");

    const detailRow = await pool.query(
      `SELECT state_json, transcript FROM call_details WHERE call_sid = $1`,
      [callSid]
    );
    const state = detailRow.rows[0]?.state_json || { turn: 0, history: [] };
    const turn = Number(state.turn || 0) + 1;
    const history = Array.isArray(state.history) ? state.history : [];

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'message')`,
      [callSid, tenantKey, "caller", speech]
    );

    const done = isDonePhrase(speech) || turn >= 6;
    if (done) {
      await pool.query(`UPDATE calls SET status = 'completed' WHERE call_sid = $1`, [callSid]);
      const transcript = `${detailRow.rows[0]?.transcript || ""}\nCaller: ${speech}`.trim();
      await pool.query(
        `UPDATE call_details SET transcript = $2, updated_at = NOW() WHERE call_sid = $1`,
        [callSid, transcript]
      );
      if (appBaseUrl && callSummaryToken) {
        await fetch(`${appBaseUrl}/api/v1/calls?tenantKey=${encodeURIComponent(tenantKey)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-everycall-internal": callSummaryToken
          },
          body: JSON.stringify({
            action: "summary",
            tenantKey,
            callSid,
            summary: "Call completed.",
            extracted: { transcript }
          })
        });
      }
      res.type("text/xml").status(200).send(buildHangupResponse("Thanks. We have your details and will follow up soon."));
      return;
    }

    const prompt = await composePromptForTenant(tenantKey);
    const assistantReply = await generateAssistantReply(prompt, history, speech);
    const updatedHistory = history
      .concat({ role: "user", content: speech }, { role: "assistant", content: assistantReply })
      .slice(-12);
    const updatedTranscript = `${detailRow.rows[0]?.transcript || ""}\nCaller: ${speech}\nAssistant: ${assistantReply}`.trim();

    await pool.query(
      `UPDATE call_details
       SET state_json = $2,
           transcript = $3,
           updated_at = NOW()
       WHERE call_sid = $1`,
      [callSid, JSON.stringify({ turn, history: updatedHistory }), updatedTranscript]
    );

    await pool.query(
      `INSERT INTO call_events (call_sid, tenant_key, role, text, event_type)
       VALUES ($1, $2, $3, $4, 'message')`,
      [callSid, tenantKey, "assistant", assistantReply]
    );

    const actionUrl = `${buildBaseUrl(req)}/v1/telnyx/texml/gather?tenantKey=${encodeURIComponent(tenantKey)}&callSid=${encodeURIComponent(callSid)}`;
    res.type("text/xml").status(200).send(buildTeXMLResponse(assistantReply, actionUrl));
  } catch (err) {
    logError("telnyx_texml_gather_error", {
      message: err instanceof Error ? err.message : "unknown"
    });
    res.type("text/xml").status(200).send(buildHangupResponse("We are unable to take your call right now."));
  }
});

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "call-gateway" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError("call_gateway_unhandled_error", { message: err instanceof Error ? err.message : "unknown" });
  res.status(500).json({ error: "internal_error" });
});

app.listen(env.PORT, () => {
  logInfo("call_gateway_started", {
    port: env.PORT
  });
});
