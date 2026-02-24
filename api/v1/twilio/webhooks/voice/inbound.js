export default function handler(_req, res) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="alice">Thanks for calling EveryCall. Your call routing is now active.</Say>\n</Response>`;

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml);
}
