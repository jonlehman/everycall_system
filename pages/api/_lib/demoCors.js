function normalizeText(value) {
  return String(value || "").trim();
}

function readAllowedOrigins() {
  const explicit = String(process.env.DEMO_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => normalizeText(value))
    .filter(Boolean);

  if (explicit.length) {
    return new Set(explicit);
  }

  return new Set([
    "https://everycall.io",
    "https://www.everycall.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]);
}

export function applyDemoCors(req, res) {
  const origin = normalizeText(req?.headers?.origin);
  const allowedOrigins = readAllowedOrigins();
  if (!origin || !allowedOrigins.has(origin)) {
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

export function handleDemoCorsPreflight(req, res) {
  applyDemoCors(req, res);
  if (req.method !== "OPTIONS") {
    return false;
  }
  res.status(204).end();
  return true;
}
