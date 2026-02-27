const TELNYX_BASE_URL = "https://api.telnyx.com/v2";

export async function telnyxCallCommand({
  apiKey,
  callControlId,
  action,
  payload
}: {
  apiKey: string;
  callControlId: string;
  action: string;
  payload?: Record<string, any>;
}) {
  const resp = await fetch(`${TELNYX_BASE_URL}/calls/${callControlId}/actions/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`telnyx_command_failed:${action}:${resp.status}:${text.slice(0, 200)}`);
  }
  return resp.json();
}
