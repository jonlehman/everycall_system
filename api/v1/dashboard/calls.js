const DEFAULT_LIMIT = 30;

function getTwilioCreds() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (accountSid && authToken) {
    return { accountSid, username: accountSid, password: authToken };
  }

  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  if (accountSid && apiKeySid && apiKeySecret) {
    return { accountSid, username: apiKeySid, password: apiKeySecret };
  }

  return null;
}

function toBasicAuth(username, password) {
  return Buffer.from(`${username}:${password}`).toString("base64");
}

async function fetchTwilio(path, creds) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}${path}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Basic ${toBasicAuth(creds.username, creds.password)}`
    }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`twilio_http_${resp.status}: ${text.slice(0, 200)}`);
  }

  return resp.json();
}

export default async function handler(req, res) {
  try {
    const creds = getTwilioCreds();
    if (!creds) {
      return res.status(200).json({
        configured: false,
        calls: [],
        message: "Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (or API key creds) to enable dashboard calls"
      });
    }

    const callSid = req.query?.callSid;
    if (callSid) {
      const detail = await fetchTwilio(`/Calls/${encodeURIComponent(callSid)}.json`, creds);
      const events = await fetchTwilio(`/Calls/${encodeURIComponent(callSid)}/Events.json?PageSize=20`, creds);
      return res.status(200).json({ configured: true, detail, events: events.events || [] });
    }

    const limit = Math.max(1, Math.min(Number(req.query?.limit) || DEFAULT_LIMIT, 100));
    const payload = await fetchTwilio(`/Calls.json?PageSize=${limit}`, creds);
    const calls = (payload.calls || []).map((c) => ({
      sid: c.sid,
      status: c.status,
      direction: c.direction,
      from: c.from,
      to: c.to,
      duration: c.duration,
      start_time: c.start_time,
      end_time: c.end_time,
      price: c.price,
      price_unit: c.price_unit
    }));

    return res.status(200).json({ configured: true, calls });
  } catch (err) {
    return res.status(500).json({ error: "dashboard_calls_error", message: err?.message || "unknown" });
  }
}
