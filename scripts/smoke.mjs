import crypto from "node:crypto";

const callGateway = process.env.CALL_GATEWAY_URL ?? "http://localhost:3101";
const aiOrchestrator = process.env.AI_ORCHESTRATOR_URL ?? "http://localhost:3102";
const voiceService = process.env.VOICE_SERVICE_URL ?? "http://localhost:3103";
const twilioToken = process.env.TWILIO_AUTH_TOKEN ?? "";
const elevenVoiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID ?? "56AoDkrOh6qfVPDXZ7Pt";
const twilioToNumber = process.env.TWILIO_TEST_TO_NUMBER ?? "+13854691336";

function twilioSig(url, params, token) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => `${acc}${key}${params[key]}`, url);
  return crypto.createHmac("sha1", token).update(data, "utf8").digest("base64");
}

async function postForm(url, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers
    },
    body
  });
  return res;
}

async function main() {
  const form = {
    CallSid: "CA1234567890",
    From: "+15125550111",
    To: twilioToNumber,
    CallStatus: "ringing",
    Direction: "inbound"
  };

  const webhookUrl = `${callGateway}/v1/twilio/webhooks/voice/inbound`;
  const signature = twilioToken ? twilioSig(webhookUrl, form, twilioToken) : "";
  const cg = await postForm(webhookUrl, form, signature ? { "X-Twilio-Signature": signature } : {});
  console.log("call-gateway", cg.status, (await cg.text()).slice(0, 120));

  const ai = await fetch(`${aiOrchestrator}/v1/ai/orchestrate-turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trace_id: "trc_smoke",
      tenant_id: "ten_demo",
      call_id: "cal_smoke",
      turn_id: "turn_1",
      caller_input: { type: "text", text: "I need to book an appointment" },
      context: {
        from_number: "+15125550111",
        to_number: twilioToNumber,
        business_profile: { name: "Acme Plumbing", timezone: "America/Chicago" },
        faq_items: []
      }
    })
  });
  console.log("ai-orchestrator", ai.status, await ai.text());

  const voice = await fetch(`${voiceService}/v1/voice/synthesize-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trace_id: "trc_smoke",
      tenant_id: "ten_demo",
      call_id: "cal_smoke",
      utterance_id: "utt_smoke",
      provider: "elevenlabs",
      voice: { voice_id: elevenVoiceId, stability: 0.5, similarity_boost: 0.8, style: 0.2 },
      audio: { format: "mulaw", sample_rate_hz: 8000 },
      text: "Thanks for calling. What is your address?"
    })
  });
  const bytes = new Uint8Array(await voice.arrayBuffer());
  console.log("voice-service", voice.status, "bytes", bytes.byteLength);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
